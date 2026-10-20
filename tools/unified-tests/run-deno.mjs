// Use the pinned platform package directly; no npm install lifecycle hook is required.
import {createRequire} from 'node:module';import {dirname,join} from 'node:path';import {spawnSync} from 'node:child_process';
const names={win32:'win32',linux:'linux',darwin:'darwin'},platform=names[process.platform];
if(!platform||!['x64','arm64'].includes(process.arch))throw Error('UNSUPPORTED_DENO_TEST_PLATFORM');
const name=`@deno/${platform}-${process.arch}${platform==='linux'?'-glibc':''}`;
const pkg=createRequire(import.meta.url).resolve(name+'/package.json'),binary=join(dirname(pkg),platform==='win32'?'deno.exe':'deno');
const result=spawnSync(binary,process.argv.slice(2),{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;process.exit(result.status??1);
