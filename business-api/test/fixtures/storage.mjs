import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const id='a0000000-0000-4000-8000-000000000001';
export async function fixture(bytes=Buffer.from('synthetic GLB bytes')){
 const dir=await mkdtemp(join(tmpdir(),'village-read-unit-'));await mkdir(join(dir,'blobs'),{mode:0o700});
 const sha=createHash('sha256').update(bytes).digest('hex');
 const object={id,bucket:'group-models',name:'users/a/中文 %.glb',sha256:sha,size:bytes.length};
 const index={version:1,source_archive_sha256:'a'.repeat(64),objects:[object]};
 const indexPath=join(dir,'index.json');const blob=join(dir,'blobs',sha);
 await writeFile(blob,bytes,{mode:0o600});await writeFile(indexPath,JSON.stringify(index),{mode:0o600});
 return {dir,blob,indexPath,object,index,bytes,root:join(dir,'blobs'),cleanup:()=>rm(dir,{recursive:true,force:true})};
}
