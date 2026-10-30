const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('function syncRightPanelTogglePosition(');
const body=start<0?'':source.slice(start,source.indexOf('\nfunction syncMapSidePanelLayout(',start));
test('right toggle follows the measured panel edge at any viewport width and after collapse',()=>{
 assert.ok(body,'the toggle needs a measured anchor');let rect={left:960,width:320},value;
 const button={dataset:{},style:{setProperty:(key,next)=>{assert.equal(key,'--right-panel-edge');value=next;}}};
 const context={window:{innerWidth:1280},document:{querySelector:()=>({getBoundingClientRect:()=>rect})},rightPanelToggleBtn:button};
 const sync=vm.runInNewContext(body+';syncRightPanelTogglePosition',context);
 sync();assert.equal(value,'320px');
 context.window.innerWidth=1920;rect={left:1493.5,width:426.5};sync();assert.equal(value,'426.5px');
 rect={left:1920,width:0};sync();assert.equal(value,'0px');
 rect={left:0,width:0};sync();assert.equal(value,'0px');
});
