const statuses={INVALID_INPUT:400,UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,METHOD_NOT_ALLOWED:405,
 REVISION_CONFLICT:409,PROJECT_SUBMITTED:409,BASELINE_MISMATCH:409,FILES_NOT_READY:409,
 PAYLOAD_TOO_LARGE:413,UNSUPPORTED_MEDIA_TYPE:415,AUTH_UNAVAILABLE:503,DB_UNAVAILABLE:503,PROFILE_NOT_SYNCED:409};
export function error(code,remoteRevision){return Object.assign(new Error(code),{code,status:statuses[code]??503,
 ...(Number.isSafeInteger(remoteRevision)&&remoteRevision>=0?{remoteRevision}:{})});}
export function safeError(e){
 if(Object.hasOwn(statuses,e?.code))return error(e.code,e.remoteRevision);
 if(e?.code==='40001'&&e.message==='SCENE_EDIT_REVISION_CONFLICT')return error('REVISION_CONFLICT',/^\d+$/.test(e.detail??'')?Number(e.detail):undefined);
 const messages={SCENE_EDIT_FORBIDDEN:'FORBIDDEN',SCENE_EDIT_PROJECT_SUBMITTED:'PROJECT_SUBMITTED',SCENE_EDIT_BASELINE_MISMATCH:'BASELINE_MISMATCH',SCENE_EDIT_CONTEXT_INVALID:'INVALID_INPUT',SCENE_EDIT_SCOPE_INVALID:'INVALID_INPUT'};
 if(Object.hasOwn(messages,e?.message))return error(messages[e.message]);
 if(e?.code==='P0002')return error('NOT_FOUND');
 if(['23505','23514','23503','22P02','22003'].includes(e?.code))return error('INVALID_INPUT');
 return error('DB_UNAVAILABLE');
}
