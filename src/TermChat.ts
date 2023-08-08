import Readline from "readline";
import fs from "fs";
import os from "os";
import path from "path";

import {
    DataInterface,
    SignatureOffloader,
    SignatureOffloaderInterface,
    ParseUtil,
    FileStreamReader,
    FileStreamWriter,
    BlobEvent,
    CreateHandshakeFactoryFactory,
    HandshakeFactoryFactoryInterface,
    FileUtil,
    JSONUtil,
    TransformerCache,
    TransformerItem,
    SimpleChat,
} from "universeai";

import {
    PocketConsole,
} from "pocket-console";

let console = PocketConsole({module: "TermChat", format: "%c[%L%l]%C "});


/**
 * Terminal version of a chat based on The Universe Protocol.
 */
export class TermChat {
    protected chat: SimpleChat;
    protected handlers: {[name: string]: ( (...args: any) => void)[]} = {};

    constructor(publicKey: Buffer, signatureOffloader: SignatureOffloaderInterface,
        handshakeFactoryFactory: HandshakeFactoryFactoryInterface) {

        this.chat = new SimpleChat(publicKey, signatureOffloader, handshakeFactoryFactory, console);
    }

    public async init(config: any) {
        if (this.chat) {
            await this.chat.init(config);

            this.setupUI();

            this.chat.onChatReady( (cache: TransformerCache) => {
                cache.onAdd(this.handleAddedItem);
                cache.onInsert(this.handleInsertedItem);
                cache.onDelete(this.handleDeletedItem);
                cache.onClose(this.handleClose);
            });

            this.chat.onBlob(this.handleBlob);

            this.chat.onStop(this.handleStop);
        }
    }

    public start() {
        this.chat?.start();
    }

    public stop() {
        this.chat?.stop();
    }

    public onStop(cb: () => void) {
        this.hookEvent("stop", cb);
    }

    protected async handleCommand(command: string) {
        if (!this.chat) {
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
            const items = this.chat.getCache()?.getItems() ?? [];
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

            const stat = fs.statSync(filepath);

            const blobLength = BigInt(stat.size);

            const filename = path.basename(filepath);

            const blobHash = await FileUtil.HashFile(filepath);

            console.warn(blobHash.toString("hex"));

            const streamReader = new FileStreamReader(filepath);

            console.info(`Uploading file ${filepath}`);

            await this.chat.sendAttachment(filename, blobHash, blobLength, streamReader);

            console.info(`Done uploading file ${filepath}`);
        }
        else {
            console.error(`Unknown command: ${command}`);
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
                this.chat?.sendChat(input);
            }
        });

        // This hook will quit the chat on ctrl-c and ctrl-d.
        readline.on("close", () => this.stop() );
    }

    protected handleStop = () => {
        this.triggerEvent("stop");
    };

    protected handleAddedItem = (transformerItem: TransformerItem) => {
        const {node, index} = transformerItem;
        const dataNode = node as DataInterface;

        if (dataNode.getContentType() === "app/chat/attachment") {
            const id1Str = (dataNode.getId1() as Buffer).toString("hex");

            console.log(`${index} (new): <attachment> ${dataNode.getData()?.toString()}`);
        }
        else {
            console.log(`${index} (new): ${dataNode.getData()?.toString()}`);
        }
    };

    protected handleInsertedItem = (transformerItem: TransformerItem) => {
        const {node, index} = transformerItem;
        const dataNode = node as DataInterface;

        if (dataNode.getContentType() === "app/chat/attachment") {
            const id1Str = (dataNode.getId1() as Buffer).toString("hex");

            console.log(`${index} (old): <attachment> ${dataNode.getData()?.toString()}`);
        }
        else {
            console.log(`${index} (old): ${dataNode.getData()?.toString()}`);
        }
    };

    protected handleDeletedItem = (transformerItem: TransformerItem) => {
        const {node, index} = transformerItem;

        console.info(`Message with index ${index} deleted.`);
    };

    protected handleClose = () => {
        console.info("Message history has been purged. Due to storage disconnect.");
    };

    protected handleBlob = async (blobEvent: BlobEvent) => {
        if (blobEvent.error) {
            console.debug("Error occured when syncing blob", blobEvent.error);
        }
        else {
            const nodeId1 = blobEvent.nodeId1;

            console.debug("Blob data is ready for node", nodeId1.toString("hex"));

            const [streamReader, node] = this.chat.getAttachment(nodeId1);

            if (!streamReader || !node) {
                return;
            }

            const basename = path.basename((node.getData() as Buffer).toString());

            const downloadDir = `${os.homedir()}${path.sep}TermChatDownloads`;

            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir);
            }

            const id1Str = nodeId1.toString("hex");

            const filepath = `${downloadDir}${path.sep}${id1Str}-${basename}`;

            console.info(`Downloading file as: ${filepath}`);

            // TODO: allowResume is not yet working so not used as for now.
            const streamWriter = new FileStreamWriter(filepath, streamReader, false);

            try {
                await streamWriter.run();
            }
            catch(e) {
                throw e;
            }
            finally {
                streamReader.close();
                streamWriter.close();
            }
        }
    };

    protected hookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = this.handlers[name] || [];
        this.handlers[name] = cbs;
        cbs.push(callback);
    }

    protected unhookEvent(name: string, callback: ( (...args: any) => void)) {
        const cbs = (this.handlers[name] || []).filter( (cb: ( (...args: any) => void)) => callback !== cb );
        this.handlers[name] = cbs;
    }

    protected triggerEvent(name: string, ...args: any) {
        const cbs = this.handlers[name] || [];
        cbs.forEach( (callback: ( (...args: any) => void)) => {
            setImmediate( () => callback(...args) );
        });
    }
}

function main(): Promise<number> {
    return new Promise( async (resolve, reject) => {
        if (process.argv.length < 3) {
            console.getConsole().error(`Usage: TermChat.ts file.json`);
            resolve(1);
            return;
        }

        let configFilepath = process.argv[2];

        if (typeof(configFilepath) !== "string") {
            console.getConsole().error("Missing argument filepath for config file");
            resolve(1);
            return;
        }

        let config;
        try {
            config = JSONUtil.LoadJSON(configFilepath, ['.']);
        }
        catch(e) {
            console.error((e as Error).message);
            resolve(1);
            return;
        }

        const keyPair = ParseUtil.ParseKeyPair(config.keyPair);

        const handshakeFactoryFactory = CreateHandshakeFactoryFactory(keyPair);

        const signatureOffloader = new SignatureOffloader();

        await signatureOffloader.init();

        await signatureOffloader.addKeyPair(keyPair);

        const termChat = new TermChat(keyPair.publicKey, signatureOffloader, handshakeFactoryFactory);

        try {
            await termChat.init(config);
        }
        catch(e) {
            console.error("Could not init TermChat", (e as Error).message);
            signatureOffloader.close();
            resolve(1);
            return;
        }

        termChat.onStop( () => {
            signatureOffloader.close();
            resolve(0);
        });

        termChat.start();
    });
}

main().then( (statusCode) => {
    process.exit(statusCode);
});
