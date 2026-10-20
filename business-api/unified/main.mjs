import {createServer} from 'node:http';import {readFile,lstat} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {loadUnifiedConfig} from './config.mjs';import {createUnifiedServices} from './services.mjs';import {createUnifiedHandler,closeUnifiedServices} from './http.mjs';import {createSceneFilesHandler} from '../scene-files/http.mjs';
import {measure} from './metrics.mjs';
import {createLocalWorkerHandler} from '../local-tasks/http.mjs';
export async function startUnifiedServer(config=loadUnifiedConfig()){
 const st=await lstat(config.releaseFile);if(!st.isFile()||st.isSymbolicLink()||st.size>16384)throw Error('INVALID_RELEASE');const release=JSON.parse(await readFile(config.releaseFile,'utf8'));
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(release.releaseId??'')||release.schemaVersion!==1)throw Error('INVALID_RELEASE');
 const services=await createUnifiedServices(config),close=closeUnifiedServices(services);
 const sceneHandler=createSceneFilesHandler({verifyIdentity:header=>measure('auth',()=>services.verifyIdentity(header)),database:services.scene,uploads:services.sceneUploads});
 const handler=createUnifiedHandler({services,verifyIdentity:services.verifyIdentity,release,sceneHandler,log:record=>console.log(JSON.stringify(record))});
 const workerHandler=services.workerQueue?createLocalWorkerHandler({queue:services.workerQueue,log:record=>console.log(JSON.stringify(record))}):null;
 const server=createServer({maxHeaderSize:20000,requestTimeout:120000,headersTimeout:10000},(req,res)=>workerHandler&&req.url?.startsWith('/api/worker/v1/')?workerHandler(req,res):handler(req,res));server.setTimeout(130000,s=>s.destroy());
 let stopping;async function stop(){return stopping??(stopping=(async()=>{const ended=new Promise(r=>server.close(r));await close();await ended;})());}
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',resolve);});if(config.bridge.enabled||services.workerQueue)services.tasks.start();return {server,services,stop};}catch(e){await close();throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const runtime=await startUnifiedServer();console.log('UNIFIED_INTERNAL_STARTED');const stop=()=>{const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();runtime.stop().then(()=>process.exit(0),()=>process.exit(1));};process.once('SIGTERM',stop);process.once('SIGINT',stop);}
 catch{console.error('UNIFIED_CONFIGURATION_OR_STARTUP_FAILED');process.exitCode=1;}
}
