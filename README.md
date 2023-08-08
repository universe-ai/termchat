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
./universe/src/sdk/tools/keygen >./conf/serverKeyfile.json
./universe/src/sdk/tools/keygen >./conf/client1Keyfile.json
./universe/src/sdk/tools/keygen >./conf/client2Keyfile.json
```

## Run
Run the storage service:  
```sh
node -r ts-node/register ./src/TermChatServer.ts ./conf/server.json
```

Run the first client:  
```sh
node -r ts-node/register ./src/TermChat.ts ./conf/client1.json
```

Run the second client:  
```sh
node -r ts-node/register ./src/TermChat.ts ./conf/client2.json
```
