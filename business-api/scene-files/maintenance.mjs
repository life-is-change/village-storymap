import {fault} from './contracts.mjs';
// An offline entry point used by the guarded deployment tool, never an HTTP route.
export async function runMaintenance(uploads,{execute=false}={}){
 if(typeof execute!=='boolean')throw fault('INVALID_INPUT');return uploads.cleanup({execute});
}
