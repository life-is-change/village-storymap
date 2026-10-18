import {randomUUID} from 'node:crypto';
export const userA='10000000-0000-4000-8000-000000000001';
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
export function glbHeader(binarySize=0,extra={}){
 const value={asset:{version:'2.0'},...(binarySize?{buffers:[{byteLength:binarySize}]}:{}),...extra};
 let json=Buffer.from(JSON.stringify(value));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
 const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+(binarySize?8+binarySize:0),8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bin=Buffer.alloc(binarySize?8:0);if(binarySize){bin.writeUInt32LE(binarySize);bin.writeUInt32LE(0x004e4942,4);}return Buffer.concat([header,json,bin]);
}
export const glb=()=>glbHeader();
export function assetInput(files=[{role:'display',size:glb().length,mime:'model/gltf-binary',extension:'glb'}]){
 return {requestId:randomUUID(),purpose:'asset',context:{courseId:'course',groupId:null,scopeKind:'personal',kind:'model'},files};
}
