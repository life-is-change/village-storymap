import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {Readable} from 'node:stream';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';import {glb,png} from './fixtures/scene-files.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';import {createStorageReader} from '../src/storage.mjs';import {createBusinessFileStore} from '../unified/file-store.mjs';import {createBusinessFilesService} from '../unified/files.mjs';import {createModelsService} from '../unified/models.mjs';
const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A'};
test('native ordinary files commit atomically, preserve model history and authorize all legacy mappings',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  const root=await mkdtemp(join(tmpdir(),'unified-files-native-'));let db;
  try{
   const next=join(root,'next'),legacy=join(root,'legacy');await mkdir(next,{mode:0o700});await mkdir(legacy,{mode:0o700});
   const index={version:1,source_archive_sha256:'a'.repeat(64),objects:[]};
   for(let i=0;i<23;i++){
    const id=randomUUID(),photo=i<11,model=i>=11&&i<13,bucket=photo?'house-photos':model?'group-models':'village-datasets',name=(photo?'photo/':model?'shared/A/':'dataset/')+id+(model?'.glb':'.png'),bytes=model?glb():png,sha256=createHash('sha256').update(bytes).digest('hex');
    await setup.query("INSERT INTO storage.objects VALUES($1,$2,$3,'2026-10-19T00:00:00Z',$4,'v1')",[id,bucket,name,JSON.stringify({size:bytes.length,eTag:'v1'})]);
    if(photo)await setup.query("INSERT INTO object_photos(object_code,object_type,photo_url,photo_path,uploaded_by,teaching_project_id,village_id,space_id) VALUES('B1','building','unused',$1,'A',$2,$3,'A')",[name,c.teachingProjectId,c.villageId]);
    if(model)await setup.query("INSERT INTO group_model_assets(id,name,storage_path,file_size,scope_kind,owner_id,created_by,source_space_id) VALUES($1,'Legacy',$2,$3,'shared',$4,$4,'A')",[id,name,bytes.length,USERS.admin]);
    await writeFile(join(legacy,sha256),bytes,{mode:0o600});index.objects.push({id,bucket,name,size:bytes.length,sha256,declared_size:bytes.length,snapshot_updated_at:'2026-10-19T00:00:00.000000Z',snapshot_etag:'v1',snapshot_version:'v1'});
   }
   const indexPath=join(root,'index.json');await writeFile(indexPath,JSON.stringify(index),{mode:0o600});
   for(const name of ['files','events'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
   db=createUnifiedDatabase(config);const store=await createBusinessFileStore({root:next,instanceId:'aliyun-files-test'}),legacyReader=await createStorageReader({root:legacy,indexPath});
   const files=createBusinessFilesService({database:db,store,legacyReader,spaceAvailable:async()=>10*1024**3}),models=createModelsService({database:db});
   const personalContext={...c,spaceId:'a0000000-0000-4000-8000-000000000001'};
   await db.withIdentity(testIdentity(),q=>q.query('SELECT api_private.event_read($1::jsonb,NULL)',[JSON.stringify([personalContext])]));
   await assert.rejects(db.withIdentity(testIdentity(USERS.other),q=>q.query('SELECT api_private.event_read($1::jsonb,NULL)',[JSON.stringify([personalContext])])),{code:'FORBIDDEN'});
   for(const object of index.objects){const h=await files.read(testIdentity(USERS.admin),object.id);assert.equal(h.size,object.size);await h.close();}
   const legacyPhotos=await db.withIdentity(testIdentity(),async q=>(await q.query('SELECT api_private.survey_read($1,$2::jsonb) data',['survey.listPhotos',JSON.stringify({...c,objectCode:'B1',objectType:'building'})])).rows[0].data);
   assert.equal(legacyPhotos.length,11);assert.ok(legacyPhotos.every(p=>index.objects.some(o=>o.id===p.fileId)));
   await setup.query("UPDATE object_photos SET space_id='B' WHERE photo_path=$1",[index.objects[0].name]);await assert.rejects(files.read(testIdentity(),index.objects[0].id),{code:'FORBIDDEN'});
   await setup.query('UPDATE object_photos SET teaching_project_id=NULL,village_id=NULL,space_id=NULL WHERE photo_path=$1',[index.objects[0].name]);
   const unscoped=await files.read(testIdentity(USERS.admin),index.objects[0].id);await unscoped.close();
   await assert.rejects(files.read(testIdentity(),index.objects[0].id),{code:'FORBIDDEN'});
   await assert.rejects(files.read(testIdentity(USERS.teacher),index.objects[0].id),{code:'FORBIDDEN'});
   await setup.query('UPDATE object_photos SET teaching_project_id=$1,village_id=$2,space_id=$3 WHERE photo_path=$4',[c.teachingProjectId,c.villageId,'A',index.objects[0].name]);
   const request={requestId:randomUUID(),purpose:'photo',context:c,files:[{role:'photo',size:png.length,mime:'image/png',extension:'png'}]};
   const session=await files.begin(testIdentity(),request);assert.equal((await files.begin(testIdentity(),request)).id,session.id);await assert.rejects(files.read(testIdentity(),session.files[0].id),{code:'FORBIDDEN'});
   await files.put(testIdentity(),session.id,'photo',Readable.from([png]));await files.put(testIdentity(),session.id,'photo',Readable.from([png]));
   const photo=await files.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'});assert.equal(photo.local_actor_id,USERS.student);assert.equal((await files.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'})).id,photo.id);
   const opened=await files.read(testIdentity(),photo.fileId);await opened.close();await assert.rejects(files.archive(testIdentity(),photo.fileId),{code:'FILE_IN_USE'});
   const personalSession=await files.begin(testIdentity(),{...request,requestId:randomUUID(),context:personalContext});
   await files.put(testIdentity(),personalSession.id,'photo',Readable.from([png]));
   const personalPhoto=await files.commit(testIdentity(),personalSession.id,{objectCode:'B1',objectType:'building'});
   const adminPersonal=await files.read(testIdentity(USERS.admin),personalPhoto.fileId);await adminPersonal.close();
   await assert.rejects(files.read(testIdentity(USERS.other),personalPhoto.fileId),{code:'FORBIDDEN'});
   const {createSurveyService}=await import('../unified/survey.mjs');
   const survey=createSurveyService({database:db,taskReferences:{async assertPhotoMutable(){}}});
   await survey.execute(testIdentity(),'survey.deletePhoto',{photoId:photo.id,requestId:randomUUID()});
   const again=await files.begin(testIdentity(),{...request,requestId:randomUUID()});
   await files.put(testIdentity(),again.id,'photo',Readable.from([png]));
   const replacement=await files.commit(testIdentity(),again.id,{objectCode:'B1',objectType:'building'});
   assert.notEqual(replacement.id,photo.id);assert.notEqual(replacement.fileId,photo.fileId);
   const afterDelete=await files.read(testIdentity(),replacement.fileId);await afterDelete.close();
   await assert.rejects(files.begin(testIdentity(),{...request,requestId:randomUUID(),purpose:'group-model',files:[{role:'display',size:glb().length,mime:'model/gltf-binary',extension:'glb'}]}),{code:'FORBIDDEN'});
   const modelSession=await files.begin(testIdentity(USERS.admin),{...request,requestId:randomUUID(),purpose:'group-model',files:['display','original','low'].map(role=>({role,size:glb().length,mime:'model/gltf-binary',extension:'glb'}))});
   for(const role of ['display','original','low'])await files.put(testIdentity(USERS.admin),modelSession.id,role,Readable.from([glb()]));
   const asset=await files.commit(testIdentity(USERS.admin),modelSession.id,{name:'Local model',metadata:{normalized:true,size:[1,1,1]}});assert.match(asset.normalization.lowStoragePath,/ordinary\//);
   const place={...c,assetId:asset.id,objectCode:'B1',transform:{scale:1},requestId:randomUUID()};await models.execute(testIdentity(USERS.admin),'models.place',place);assert.equal((await models.execute(testIdentity(),'models.bindings',c)).length,1);
   await assert.rejects(models.execute(testIdentity(USERS.admin),'models.delete',{assetId:asset.id,requestId:randomUUID()}),{code:'FILE_IN_USE'});
   await models.execute(testIdentity(USERS.admin),'models.restoreWhiteModel',{...c,objectCode:'B1',requestId:randomUUID()});assert.equal((await models.execute(testIdentity(),'models.bindings',c)).length,0);
   const deleted=await models.execute(testIdentity(USERS.admin),'models.delete',{assetId:asset.id,requestId:randomUUID()});assert.equal(deleted.retainedForHistory,true);const historical=await files.read(testIdentity(),modelSession.files[0].id);await historical.close();
   await assert.rejects(models.execute(testIdentity(USERS.admin),'models.place',{...place,requestId:randomUUID()}),{code:'FORBIDDEN'});
   assert.equal((await setup.query('SELECT count(*) n FROM model_operation_events WHERE asset_id=$1',[asset.id])).rows[0].n,'4');
   const abandoned=await files.begin(testIdentity(),{...request,requestId:randomUUID()});await assert.rejects(files.put(testIdentity(),abandoned.id,'photo',Readable.from([png.subarray(0,12)])),{code:'INVALID_FILE'});await files.archive(testIdentity(),abandoned.files[0].id);assert.equal((await files.cleanup({execute:true})).files,1);
   const names=['boundary.geojson','imagery.webp','buildings.geojson','roads.geojson','waterways.geojson','water_areas.geojson','water.geojson','contours.geojson'],polygon={type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]};
   const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBP',8);webp.write('VP8L',12);webp.writeUInt32LE(5,16);webp[20]=0x2f;
   const contents=Object.fromEntries(names.map(name=>[name,name==='imagery.webp'?webp:Buffer.from(JSON.stringify({type:'FeatureCollection',features:['boundary.geojson','buildings.geojson'].includes(name)?[{type:'Feature',properties:{},geometry:polygon}]:[]}))]));
   const manifest={schema_version:'village-v0-package/1',village:{name:'Synthetic',bounds:[113,23,113.001,23.001]},imagery:{path:'imagery.webp'},files:names.map(path=>({path,sha256:createHash('sha256').update(contents[path]).digest('hex')})),layers:[['building','buildings.geojson',1],['road','roads.geojson',0],['water','water.geojson',0],['contours','contours.geojson',0]].map(([type,path,featureCount])=>({type,path,featureCount}))};
   contents['manifest.json']=Buffer.from(JSON.stringify(manifest));contents['validation.json']=Buffer.from('{"valid":true}');
   const datasetRequest={requestId:randomUUID(),purpose:'dataset',context:{villageId:c.villageId},files:Object.entries(contents).map(([role,b])=>({role,size:b.length,mime:role.endsWith('.geojson')?'application/geo+json':role.endsWith('.webp')?'image/webp':'application/json',extension:role.split('.').at(-1)}))};
   await assert.rejects(files.begin(testIdentity(),datasetRequest),{code:'FORBIDDEN'});
   const packageSession=await files.begin(testIdentity(USERS.admin),datasetRequest);
   for(const [role,b] of Object.entries(contents))await files.put(testIdentity(USERS.admin),packageSession.id,role,Readable.from([b]));
   const dataset=await files.commit(testIdentity(USERS.admin),packageSession.id,{versionLabel:'Native package'});assert.equal(dataset.status,'ready');assert.match(dataset.imagery_config.path,/ordinary\//);
   const imagery=packageSession.files.find(f=>f.role==='imagery.webp');await assert.rejects(files.read(testIdentity(),imagery.id),{code:'FORBIDDEN'});
   await setup.query("UPDATE village_datasets SET status='published' WHERE id=$1",[dataset.id]);const published=await files.read(testIdentity(),imagery.id);await published.close();
  }finally{await db?.close();await rm(root,{recursive:true,force:true});}
 });
});
