// Validate large GeoJSON without materializing the feature array. Manifest and
// validation documents are small and parsed separately at package commit.
import {fault} from '../scene-files/contracts.mjs';
export async function validateGeoJSON(handle,size,role){
 const allowed={ 'buildings.geojson':['Polygon','MultiPolygon'],'boundary.geojson':['Polygon','MultiPolygon'],'roads.geojson':['LineString','MultiLineString'],'waterways.geojson':['LineString','MultiLineString'],'water_areas.geojson':['Polygon','MultiPolygon'],'water.geojson':['Polygon','MultiPolygon','LineString','MultiLineString'],'contours.geojson':['LineString','MultiLineString']}[role];
 const decoder=new TextDecoder('utf-8',{fatal:true}),stack=[];let rootDone=false,mode=null,token='',escape=false,total=0,topType=null,features=false,featureCount=0;
 const invalid=()=>{throw fault('INVALID_FILE');};
 function value(v,container=false){
  if(!stack.length){if(rootDone||!container||v!=='{')invalid();rootDone=true;return;}
  const s=stack.at(-1);if(s.type==='{'&&s.state==='key'){if(container||typeof v!=='string'||['__proto__','prototype','constructor'].includes(v)||s.keys.has(v)||s.keys.size>=4096)invalid();s.keys.add(v);s.key=v;s.state='colon';return;}
  if(!['value','first'].includes(s.state))invalid();
  if(stack.length===1&&s.type==='{'){if(s.key==='type')topType=v;if(s.key==='features'){if(!container||v!=='['||features)invalid();features=true;}}
  if(s.featureArray){if(!container||v!=='{')invalid();featureCount++;}
  if(s.feature&&s.key==='type'){if(v!=='Feature'||container)invalid();s.hasType=true;}
  if(s.feature&&s.key==='geometry'){if(!container||v!=='{')invalid();s.hasGeometry=true;}
  if(s.geometry&&s.key==='type'){if(container||!allowed?.includes(v))invalid();s.hasType=true;}
  if(s.geometry&&s.key==='coordinates'){if(!container||v!=='[')invalid();s.hasCoordinates=true;}
  if(s.geoCoords){if(container){if(v!=='['||s.numbers)invalid();s.arrays++;}else{if(typeof v!=='number'||s.arrays||++s.numbers>3||Math.abs(v)>(s.numbers===1?180:s.numbers===2?90:1000000))invalid();}}
  s.state='after';
 }
 function emit(t){
  if(++total>5000000)invalid();
  if(t==='{'||t==='['){const parent=stack.at(-1),frame={type:t,state:t==='{'?'keyFirst':'first',keys:new Set(),feature:!!parent?.featureArray,geometry:!!(parent?.feature&&parent.key==='geometry'),featureArray:stack.length===1&&parent?.key==='features',geoCoords:!!parent?.geoCoords||!!(parent?.geometry&&parent.key==='coordinates'),numbers:0,arrays:0};value(t,true);stack.push(frame);if(stack.length>64)invalid();return;}
  if(t==='}'||t===']'){const s=stack.pop();if(!s||s.type!==(t==='}'?'{':'[')||!['after',s.type==='{'?'keyFirst':'first'].includes(s.state))invalid();if(s.feature&&(!s.hasType||!s.hasGeometry)||s.geometry&&(!s.hasType||!s.hasCoordinates)||s.geoCoords&&(s.numbers===1||!s.numbers&&!s.arrays))invalid();return;}
  const s=stack.at(-1);
  if(t===','){if(!s||s.state!=='after')invalid();s.state=s.type==='{'?'key':'value';return;}
  if(t===':'){if(!s||s.state!=='colon')invalid();s.state='value';return;}
  if(s?.state==='keyFirst')s.state='key';
  let v;try{v=JSON.parse(t);}catch{invalid();}if(typeof v==='number'&&!Number.isFinite(v))invalid();value(v);
 }
 function consume(text){for(const ch of text){
  if(mode==='string'){token+=ch;if(token.length>65536)invalid();if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch==='"'){emit(token);token='';mode=null;}continue;}
  if(mode==='literal'){if(/[ \t\r\n{}\[\],:]/.test(ch)){emit(token);token='';mode=null;}else{token+=ch;if(token.length>100)invalid();continue;}}
  if(/[ \t\r\n]/.test(ch))continue;if('{}[],:'.includes(ch)){emit(ch);continue;}token=ch;mode=ch==='"'?'string':'literal';
 }}
 try{const b=Buffer.alloc(65536);let p=0;while(p<size){const {bytesRead}=await handle.read(b,0,Math.min(b.length,size-p),p);if(!bytesRead)invalid();consume(decoder.decode(b.subarray(0,bytesRead),{stream:true}));p+=bytesRead;}consume(decoder.decode());if(mode==='literal'){emit(token);mode=null;}if(mode||stack.length||!rootDone||topType!=='FeatureCollection'||!features)invalid();return {featureCount};}catch{invalid();}
}
