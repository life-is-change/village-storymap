// Synthetic local session only: no platform login, uploads, paid APIs or GPU jobs.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const three=process.env.GENERATOR_TEST_THREE;
if(!three)throw Error('Set GENERATOR_TEST_THREE to the existing three@0.164.1 package directory');
const output=process.env.GENERATOR_TEST_OUTPUT;
const model=process.env.GENERATOR_TEST_MODEL;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://local');
  if(model&&url.pathname==='/__model.glb'){res.setHeader('Content-Type','model/gltf-binary');return res.end(await readFile(model));}
  if(model&&url.pathname==='/__manifest.json'){
   const config=JSON.parse(await readFile(resolve(model,'../config.json'),'utf8')),s=config.spec;
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({building:{width:s.facade.width,depth:s.facade.depth,wall_height:s.metrics.wall_height,roof_height:s.roof.rise}}));
  }
  const file=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(resolve(root)+sep))throw Error('escape');
  let data=await readFile(file);
  if(url.pathname==='/rural_house_generator/app.js')data=Buffer.concat([data,Buffer.from('\nwindow.__generatorTest={state,applyFacadeRun,pollFacadeRun,renderGenerationMode,clearFacadePollTimer};')]);
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(data);
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.GENERATOR_TEST_CHROME?{channel:'chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith(origin+'/')||url.startsWith('data:'))return route.continue();
  if(url.startsWith('https://unpkg.com/three@0.164.1/')){
   const relative=url.split('three@0.164.1/')[1];
   const file=resolve(three,relative);
   if(!file.startsWith(resolve(three)+sep))return route.abort();
   return route.fulfill({status:200,contentType:'text/javascript',body:await readFile(file)});
  }
  return route.abort();
 });
 await page.goto(origin+'/rural_house_generator/index.html?mode=photo&length=14.81&width=8.239&footprintRectangularity=0.70');
 await page.waitForFunction(()=>window.__generatorTest);
 await page.selectOption('#generationMethod','components');
 assert.equal(await page.locator('#generationConstraint').isVisible(),true);
 assert.equal(await page.locator('#generateBtn').isDisabled(),true);
 assert.equal(await page.locator('#generationSourceCard').isVisible(),false);
 await page.evaluate(()=>{window.__generatorTest.state.footprintRectangularity=.9692395268270527;window.__generatorTest.renderGenerationMode();});
 assert.equal(await page.locator('#generateBtn').isDisabled(),false);
 assert.match(await page.locator('#generationConstraint').textContent(),/均值|近似/);
 if(output){await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'existing-unsupported.png')});}
 await page.selectOption('#modelPurpose','design');
 assert.equal(await page.locator('#generationConstraint').isVisible(),false);
 assert.deepEqual(await page.locator('#photoSteps [data-step]:visible').allTextContents(),['1. 上传正立面','2. 确认参数','3. 识别与建模']);
 await page.evaluate(async()=>{
  const t=window.__generatorTest,s=t.state;
  const run={id:'synthetic-run',status:'awaiting_crop',generation_method:'components',model_purpose:'design'};
  s.photoJobId=run.id;s.facadeRunRevision=1;s.photoServiceStatus='online';
  let ready=false,available=true;
  const preview='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  s.facadeQueue={getRun:async()=>run,getWorkerAvailability:async()=>{if(!available)throw Error('heartbeat unavailable');return {available:true};},listArtifacts:async()=>ready?[{artifact_type:'rectified_preview',storage_path:'synthetic.png'}]:[],createArtifactUrl:async()=>preview};
  await t.pollFacadeRun();t.clearFacadePollTimer();
  window.__trial={setReady:()=>{ready=true;},dropHeartbeat:()=>{available=false;}};
 });
 await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('正在同步预览图'));
 assert.equal(await page.locator('#photoGenerateBtn').isDisabled(),true);
 assert.equal(await page.locator('#generateBtn').isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.__generatorTest.state.photoServiceStatus),'online');
 await page.evaluate(async()=>{window.__trial.setReady();await window.__generatorTest.pollFacadeRun();window.__generatorTest.clearFacadePollTimer();});
 assert.equal(await page.locator('#photoGenerateBtn').isDisabled(),false);
 assert.equal(await page.locator('#generateBtn').isDisabled(),false);
 // A heartbeat failure must not discard an otherwise readable task or reset the photo.
 const preview=await page.locator('#photoPreview').getAttribute('src');
 await page.evaluate(async()=>{window.__trial.dropHeartbeat();await window.__generatorTest.pollFacadeRun();window.__generatorTest.clearFacadePollTimer();});
 assert.equal(await page.locator('#photoPreview').getAttribute('src'),preview);
 if(output)await page.screenshot({path:resolve(output,'design-ready.png')});
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow at '+width);
  const layout=await page.locator('.generation-card').evaluate(card=>({padding:parseFloat(getComputedStyle(card).paddingLeft),title:card.querySelector('h2').getBoundingClientRect().x-card.getBoundingClientRect().x}));
  assert.ok(layout.padding>=16&&layout.title>=16,'card padding at '+width);
  if(output)await page.screenshot({path:resolve(output,'design-'+width+'.png')});
 }
 if(model){
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(async()=>{
   const t=window.__generatorTest,s=t.state,run={id:'model-run',status:'completed',generation_method:'components',model_purpose:'design'};
   s.photoJobId=run.id;s.currentFacadeRun=null;s.facadeRunRevision++;
   s.facadeQueue={listArtifacts:async()=>[{artifact_type:'building_glb',storage_path:'/__model.glb'},{artifact_type:'model_manifest',storage_path:'/__manifest.json'}],createArtifactUrl:async p=>p};
   await t.applyFacadeRun(run);t.clearFacadePollTimer();
  });
  await page.waitForFunction(()=>window.__generatorTest.state.currentBlob);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#downloadBtn').isDisabled(),false);
  if(output)await page.locator('#viewer').screenshot({path:resolve(output,'actual-model-web.png')});
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'generator_browser_passed',viewportWidths:[1440,1280,390],previewDelayRecovery:true,unsupportedFootprintBlocked:true,designSkipsRectification:true,realGpuJobs:false}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
