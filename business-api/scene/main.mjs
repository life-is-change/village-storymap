import {createServer} from 'node:http';
import {loadSceneConfig} from './config.mjs';
import {createIdentityVerifier} from '../src/auth.mjs';
import {createSceneDatabase} from './database.mjs';
import {createSceneHandler} from './http.mjs';
try{
 const config=loadSceneConfig(),database=createSceneDatabase(config.database);
 const server=createServer({maxHeaderSize:20000,requestTimeout:15000,headersTimeout:10000},createSceneHandler({verifyIdentity:createIdentityVerifier(config),database}));
 server.setTimeout(20000,socket=>socket.destroy());
 server.on('error',()=>{console.error('SCENE_API_START_FAILED');process.exitCode=1;database.close();});
 server.listen(config.port,'0.0.0.0',()=>console.log('SCENE_API_INTERNAL_STARTED'));
 const stop=()=>{server.close(async()=>{await database.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{console.error('SCENE_API_CONFIGURATION_INVALID');process.exitCode=1;}
