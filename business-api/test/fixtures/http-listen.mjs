import {randomInt} from 'node:crypto';
// Some Windows hosts allocate low ephemeral ports blocked by WHATWG fetch
// (for example 6000). Use an unprivileged, fetch-safe loopback range in tests.
export async function listenLoopback(server){
 for(let attempt=0;attempt<10;attempt++){
  try{await new Promise((resolve,reject)=>{const done=()=>{server.off('error',reject);resolve();};server.once('error',reject);server.listen(randomInt(30000,60000),'127.0.0.1',done);});return server.address();}
  catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}
 }
 throw Error('TEST_LOOPBACK_PORT_UNAVAILABLE');
}
