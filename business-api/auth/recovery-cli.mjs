import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {privateSecret} from '../unified/config.mjs';
import {createUnifiedDatabase,poolOptions} from '../unified/database.mjs';
import {createRecoveryAuth,createRecoveryService} from './recovery.mjs';

export async function readRecoveryInput(stream){
 let bytes=0;const parts=[];for await(const chunk of stream){bytes+=chunk.length;if(bytes>16384)throw Error('INVALID_INPUT');parts.push(chunk);}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{throw Error('INVALID_INPUT');}
}

async function run(){
 // Fixed internal aliases and private mounts supplied by the verified release
 // operator wrapper. No arguments, origins or secret paths come from stdin.
 const password=privateSecret('/run/secrets/api-password'),jwtSecret=privateSecret('/run/secrets/auth-jwt');
 const pool=new pg.Pool({...poolOptions({host:'postgres',port:5432,database:'village_unified_candidate',user:'village_unified_login',password}),max:1});
 const authPolicy={authMode:'local',authOrigin:'https://8.148.248.237',authInternalOrigin:'http://auth:9999'};
 const database=createUnifiedDatabase({pool},{authPolicy});
 try{
  const auth=createRecoveryAuth({jwtSecret,checkLocalSession:database.checkLocalSession});
  const input=await readRecoveryInput(process.stdin);const result=await createRecoveryService({database,auth}).reset(input);
  console.log(JSON.stringify(result));
 }finally{await database.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await run();}catch(error){const codes=['INVALID_INPUT','UNAUTHORIZED','FORBIDDEN','RATE_LIMITED','REVISION_CONFLICT','RECOVERY_UNKNOWN','AUTH_UNAVAILABLE','DB_UNAVAILABLE'];console.error('STOP: LOCAL_RECOVERY_FAILED '+(codes.includes(error?.code??error?.message)?error.code??error.message:'DB_UNAVAILABLE'));process.exitCode=1;}
}
