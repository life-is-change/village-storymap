import {UUID} from '../src/contracts.mjs';
export const MiB=1024*1024;
const status={INVALID_INPUT:400,INVALID_FILE:422,FILE_TYPE_UNSUPPORTED:415,FILE_TOO_LARGE:413,FILE_BUSY:503,FILE_UNAVAILABLE:503,FORBIDDEN:403,UNAUTHORIZED:401,NOT_FOUND:404,UPLOAD_CONFLICT:409,UPLOAD_EXPIRED:410,QUOTA_EXCEEDED:507,FILES_NOT_READY:409,FILE_SCOPE_MISMATCH:403,DB_UNAVAILABLE:503,AUTH_UNAVAILABLE:503,PROFILE_NOT_SYNCED:403,REVISION_CONFLICT:409,METHOD_NOT_ALLOWED:405,UNSUPPORTED_MEDIA_TYPE:415,PROJECT_SUBMITTED:409,BASELINE_MISMATCH:409};
export const fault=code=>Object.assign(new Error(Object.hasOwn(status,code)?code:'FILE_UNAVAILABLE'),{code:Object.hasOwn(status,code)?code:'FILE_UNAVAILABLE',status:status[code]??503});
export function safeError(e){return Object.hasOwn(status,e?.code)?fault(e.code):fault('DB_UNAVAILABLE');}
export const uuid=v=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase();
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const text=(v,n=200)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
export function fields(v,allowed,required=allowed){if(!plain(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))throw fault('INVALID_INPUT');}
export function fileLimit({role,mime,extension},kind='model'){
 if(extension==='svg'||mime==='image/svg+xml')throw fault('FILE_TYPE_UNSUPPORTED');
 const pair={glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
 if(pair[extension]!==mime)throw fault('FILE_TYPE_UNSUPPORTED');
 if(role==='preview'||role==='top'){if(extension!=='png')throw fault('FILE_TYPE_UNSUPPORTED');return 10*MiB;}
 if(kind==='model'){if(extension!=='glb')throw fault('FILE_TYPE_UNSUPPORTED');return 50*MiB;}
 if(role!=='display'||extension==='glb'||kind==='symbol'&&extension!=='png')throw fault('FILE_TYPE_UNSUPPORTED');
 return (kind==='symbol'?5:10)*MiB;
}
export function parseUploadRequest(i){
 fields(i,['requestId','purpose','context','files']);if(!uuid(i.requestId)||!['asset','version-preview','component-preview'].includes(i.purpose)||!Array.isArray(i.files)||!i.files.length||i.files.length>5)throw fault('INVALID_INPUT');
 const c=i.context;
 if(i.purpose==='version-preview'){fields(c,['projectId','revision']);if(!uuid(c.projectId)||!Number.isSafeInteger(c.revision)||c.revision<0)throw fault('INVALID_INPUT');}
 else{fields(c,['courseId','groupId','scopeKind',...(i.purpose==='asset'?['kind']:[])]);if(!text(c.courseId)||!['personal','group'].includes(c.scopeKind)||(c.scopeKind==='group'?!text(c.groupId):c.groupId!==null)||i.purpose==='asset'&&!['model','texture','symbol'].includes(c.kind))throw fault('INVALID_INPUT');}
 const roles=new Set();for(const f of i.files){fields(f,['role','size','mime','extension']);if(roles.has(f.role)||!['original','display','low','low-original','top','preview'].includes(f.role))throw fault('INVALID_INPUT');roles.add(f.role);const limit=fileLimit(f,c.kind);if(!Number.isSafeInteger(f.size)||f.size<=0||f.size>limit)throw fault('FILE_TOO_LARGE');}
 if(i.purpose==='asset'){
  if(!roles.has('display')||roles.has('preview')||roles.has('low-original')&&!roles.has('low')||c.kind!=='model'&&(roles.size!==1))throw fault('INVALID_INPUT');
 }else if(roles.size!==1||!roles.has('preview'))throw fault('INVALID_INPUT');
 return structuredClone(i);
}
