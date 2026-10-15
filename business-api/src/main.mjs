import {createServer} from 'node:http';
import {loadConfig} from './config.mjs';
import {createIdentityVerifier} from './auth.mjs';
import {createDatabase} from './database.mjs';
import * as repository from './repository.mjs';
import {createHandler} from './http.mjs';
try{
 const config=loadConfig();const database=createDatabase(config.database);
 const server=createServer({maxHeaderSize:20000,requestTimeout:30000,headersTimeout:15000},createHandler({verifyIdentity:createIdentityVerifier(config),database,repository,log:r=>console.log(JSON.stringify(r))}));
 server.setTimeout(30000,socket=>socket.destroy());
 server.on('error',()=>{console.error('API_START_FAILED');process.exitCode=1;database.close();});
 server.listen(config.port,'0.0.0.0',()=>console.log('BUSINESS_API_INTERNAL_STARTED'));
 const stop=()=>{server.close(async()=>{await database.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{console.error('API_CONFIGURATION_INVALID');process.exitCode=1;}
