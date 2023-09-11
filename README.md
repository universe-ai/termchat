# A command line chat built using The UniverseAI Protocol

This is a terminal chat application built on the [UniverseAI Protocol](https://github.com/universe-ai/universe).  

## Build

```sh
npm run i
npm run build
```

## Generate key pairs
You can use the UniverseAI project to generate ED25519 key pairs.  

```sh
git clone https://github/universe-ai/universe
cd universe
npm i
cd ..
./universe/src/sdk/tools/keygen >./conf/server-keyfile.json
./universe/src/sdk/tools/keygen >./conf/client1-keyfile.json
./universe/src/sdk/tools/keygen >./conf/client2-keyfile.json
```

## Run
Run the storage service:  
```sh
node -r ts-node/register ./src/TermChatServer.ts ./conf/server-universe.json ./conf/server-wallet.json
```

Run the first client:  
```sh
node -r ts-node/register ./src/TermChat.ts ./conf/client1-universe.json ./conf/client1-wallet.json
```

Run the second client:  
```sh
node -r ts-node/register ./src/TermChat.ts ./conf/client2-universe.json ./conf/client2-wallet.json
```
