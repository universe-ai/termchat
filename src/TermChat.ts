import { strict as assert } from "assert";

import Readline from "readline";
import fs from "fs";
import os from "os";
import path from "path";

import {
    DataInterface,
    SignatureOffloader,
    ParseUtil,
    FileStreamReader,
    FileStreamWriter,
    BlobEvent,
    CreateHandshakeFactoryFactory,
    FileUtil,
    JSONUtil,
    TransformerCache,
    TransformerItem,
    Thread,
    Service,
    P2PClient,
    StorageUtil,
    UniverseConf,
    WalletConf,
    StreamReaderInterface,
    StreamWriterInterface,
} from "universeai";

import {
    PocketConsole,
} from "pocket-console";

let console = PocketConsole({module: "TermChat", format: "%c[%L%l]%C "});


/**
 * Terminal version of a chat based on The Universe Protocol.
 */
export class TermChat {
    protected channel?: Thread;

    constructor(protected service: Service) {
        service.onStorageConnect( () => {
            console.aced("Connected to storage");

            this.channel = this.service.makeThread("channel");

            const stream = this.channel.stream();

            stream.onAdd(this.handleAddedItem);
            stream.onInsert(this.handleInsertedItem);
            stream.onDelete(this.handleDeletedItem);
            stream.onClose(this.handleClose);
        });

        service.onConnectionError( (e: {subEvent: string, e: any}) => {
            console.debug("Connection error", `${e.e.error}`);
        });

        service.onStorageClose( () => {
            console.error("Disconnected from storage");
        });

        service.onConnectionConnect( (e: {p2pClient: P2PClient}) => {
            const pubKey = e.p2pClient.getRemotePublicKey();
            console.info(`Peer just connected to service, peer's publicKey is ${pubKey.toString("hex")}`);
        });

        service.onConnectionClose( (e: {p2pClient: P2PClient}) => {
            const pubKey = e.p2pClient.getRemotePublicKey();
            console.info(`Peer disconnected, who has publicKey ${pubKey.toString("hex")}`);
        });

        this.setupUI();
    }

    protected async handleCommand(command: string) {
        if (!this.channel) {
            return;
        }

        if (command === "/help") {
            console.log(`The following commands are available:
/help (shows this help)
/history (shows the full history)
/ls (list all files in the current directory)
/upload filename (upload a file as a data node with a blob)
`);
        }
        else if (command === "/history") {
            console.info("Full history follows:");
            const items = this.channel.getTransformer()?.getItems() ?? [];
            items.forEach( (transformerItem, index) => {
                const dataNode = transformerItem.node as DataInterface;
                console.log(`${transformerItem.index}: ${dataNode.getData()?.toString()}`);
            });
        }
        else if (command === "/ls") {
            const files = fs.readdirSync("./");
            console.log(files);
        }
        else if (command.startsWith("/upload ")) {
            const filepath = command.slice(8);

            if (!fs.existsSync(filepath)) {
                console.error(`File ${filepath} does not exist.`);
                return;
            }

            this.upload(this.channel, filepath);

            console.info(`Done uploading file ${filepath}`);
        }
        else {
            console.error(`Unknown command: ${command}`);
        }
    }

    protected async sendChat(message: string) {
        if (!this.channel) {
            return;
        }

        const [node] = await this.channel.post({data: Buffer.from(message)});

        if (node) {
            this.channel.postLicense(node);
        }
    }

    protected setupUI() {
        const readline = Readline.createInterface({input: process.stdin, output: process.stderr});

        readline.on("line", (input: string) => {
            Readline.moveCursor(process.stderr, 0, -1);  // Delete our input

            if (input[0] === '/') {
                this.handleCommand(input);
            }
            else {
                this.sendChat(input);
            }
        });

        // This hook will quit the chat on ctrl-c and ctrl-d.
        readline.on("close", () => this.service.stop() );
    }

    protected handleAddedItem = (transformerItem: TransformerItem) => {
        if (!this.channel) {
            return;
        }

        const {node, index} = transformerItem;
        const dataNode = node as DataInterface;

        if (dataNode.getContentType() === "app/chat/attachment") {
            const id1Str = (dataNode.getId1() as Buffer).toString("hex");

            console.log(`${index} (new): <attachment> ${dataNode.getData()?.toString()}`);

            if (node.hasBlob()) {
                this.download(this.channel, node as DataInterface);
            }
        }
        else {
            console.log(`${index} (new): ${dataNode.getData()?.toString()}`);
        }
    };

    protected handleInsertedItem = (transformerItem: TransformerItem) => {
        if (!this.channel) {
            return;
        }

        const {node, index} = transformerItem;
        const dataNode = node as DataInterface;

        if (dataNode.getContentType() === "app/chat/attachment") {
            const id1Str = (dataNode.getId1() as Buffer).toString("hex");

            console.log(`${index} (old): <attachment> ${dataNode.getData()?.toString()}`);

            if (node.hasBlob()) {
                this.download(this.channel, node as DataInterface);
            }
        }
        else {
            console.log(`${index} (old): ${dataNode.getData()?.toString()}`);
        }
    };

    protected handleDeletedItem = (transformerItem: TransformerItem) => {
        const {node, index} = transformerItem;

        // TODO: delete attachment?

        console.debug(`Message with index ${index} deleted.`);
    };

    protected handleClose = () => {
        console.info("Message history has been purged. Due to storage disconnect.");
    };

    protected async upload(thread: Thread, filePath: string) {
        if (!this.channel) {
            return;
        }

        const stat = fs.statSync(filePath);

        const blobLength = BigInt(stat.size);

        const filename = path.basename(filePath);

        const blobHash = await FileUtil.HashFile(filePath);

        const streamReader = new FileStreamReader(filePath);

        console.info(`Uploading file ${filePath}`);

        const [node] = await this.channel.post({blobHash, blobLength, data: Buffer.from(filename)});

        if (node) {
            this.channel.postLicense(node);

            this.channel.upload(node.getId1()!, streamReader);
        }
        else {
            streamReader.close();
        }
    }

    protected download(thread: Thread, node: DataInterface):
        {streamReader: StreamReaderInterface, streamWriter: StreamWriterInterface} {

        const nodeId1 = node.getId1();

        assert(nodeId1);

        const streamReader = thread.download(nodeId1);

        const basename = path.basename((node.getData() as Buffer).toString());

        const downloadDir = `${os.homedir()}${path.sep}TermChatDownloads`;

        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir);
        }

        const id1Str = nodeId1.toString("hex");

        const filePath = `${downloadDir}${path.sep}${id1Str}-${basename}`;

        console.info(`Downloading file as: ${filePath}`);

        // TODO: allowResume is not yet working so not used as for now.
        const streamWriter = new FileStreamWriter(filePath, streamReader, false);

        // TODO make sure streamers are automatically closed on errors.
        streamWriter.run();

        return {streamReader, streamWriter};
    }
}

async function main(universeConf: UniverseConf, walletConf: WalletConf) {
    console.info("Initializing...");

    const keyPair = walletConf.keyPairs[0];
    assert(keyPair);

    const handshakeFactoryFactory = CreateHandshakeFactoryFactory(keyPair);

    const signatureOffloader = new SignatureOffloader();
    await signatureOffloader.init();

    const service = new Service(universeConf, walletConf, signatureOffloader, handshakeFactoryFactory);

    await service.init()

    const termChat = new TermChat(service);

    service.onStop( () => {
        signatureOffloader.close();
    });

    try {
        await service.start();
    }
    catch(e) {
        signatureOffloader.close();
        console.error("Could not init Service", e);
        process.exit(1);
    }
}

if (process.argv.length < 4) {
    console.getConsole().error(`Usage: service.ts universe.json wallet.json`);
    process.exit(1);
}

const universeConfigPath = process.argv[2];
const walletConfigPath = process.argv[3];

if (typeof(universeConfigPath) !== "string" || typeof(walletConfigPath) !== "string") {
    console.getConsole().error(`Usage: TermChat.ts universe.json wallet.json`);
    process.exit(1);
}

let universeConf: UniverseConf;
let walletConf: WalletConf;

try {
    universeConf = ParseUtil.ParseUniverseConf(
        JSONUtil.LoadJSON(universeConfigPath, ['.']));

    walletConf = ParseUtil.ParseWalletConf(
        JSONUtil.LoadJSON(walletConfigPath, ['.']));
}
catch(e) {
    console.error("Could not parse config files", (e as any as Error).message);
    process.exit(1);
}

main(universeConf, walletConf);
