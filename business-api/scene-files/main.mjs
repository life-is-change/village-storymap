import {createServer} from 'node:http';import {loadSceneFilesConfig} from './config.mjs';import {createIdentityVerifier} from '../src/auth.mjs';import {createStorageReader} from '../src/storage.mjs';import {createSceneFilesDatabase,queryOne} from './database.mjs';import {createFileStore} from './file-store.mjs';import {createUploadService} from './uploads.mjs';import {createSceneFilesService} from './scene.mjs';import {createSceneFilesHandler} from './http.mjs';
let database;
try{
 const config=loadSceneFilesConfig();database=createSceneFilesDatabase(config.database);const store=await createFileStore({root:config.filesRoot}),legacyReader=config.legacy?await createStorageReader(config.legacy):undefined;
 const ready=await database.withMaintenance(c=>queryOne(c,'SELECT scene_files.startup_files() AS data'));for(const f of ready){const h=await store.open(f.id,{size:Number(f.size),sha256:f.sha256});await h.close();}
 const scenes=createSceneFilesService({database,store,legacyReader}),uploads=createUploadService({database,store,legacyReader,commitPreview:scenes.commitPreview});
 const server=createServer({maxHeaderSize:20000,requestTimeout:120000,headersTimeout:10000},createSceneFilesHandler({verifyIdentity:createIdentityVerifier(config),database:scenes,uploads}));server.setTimeout(130000,s=>s.destroy());
 server.on('error',()=>{console.error('SCENE_FILES_START_FAILED');process.exitCode=1;database.close();});server.listen(config.port,'0.0.0.0',()=>console.log('SCENE_FILES_INTERNAL_STARTED'));
 const stop=()=>{server.close(async()=>{await database.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}catch{console.error('SCENE_FILES_CONFIGURATION_OR_INTEGRITY_INVALID');process.exitCode=1;await database?.close();}
