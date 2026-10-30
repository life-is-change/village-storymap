const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Network = fs.existsSync(__dirname + '/network.js') ? require('./network') : {};
const fixture = (roads, buildings = []) => ({ size:[100,100], roads:roads.map((points,i) => ({id:'r'+i,points,width:3})), buildings, scenario:{entry:[0,20]} });

test('multiple external gates reach their own road components without creating a route between components',()=>{
 const scene=fixture([[[0,20],[80,20]],[[200,20],[280,20]]],[{id:'east',entrance:[250,20]},{id:'west',entrance:[30,20]}]);
 scene.scenario.entries=[[0,20],[280,20]];
 const net=Network.buildNetwork(scene);assert.equal(net.connected.east,true);assert.equal(net.connected.west,true);
 assert.equal(Network.route(net,net.access.west,net.access.east),null);
 const exit=Network.routeToEntry(net,net.access.east);assert.equal(exit.distance,30);assert.equal(exit.entryId,'entry:1');
});
test('a short entrance connector cannot cross the excluded notch of a concave walking boundary',()=>{
 const scene=fixture([[[21,0],[21,29]]],[{id:'left',entrance:[9,25]}]);scene.scenario.entry=[21,20];scene.walkBoundary=[[0,0],[30,0],[30,30],[20,30],[20,10],[10,10],[10,30],[0,30],[0,0]];
 const net=Network.buildNetwork(scene);assert.equal(net.connected.left,false);assert.equal(net.accessDiagnostics.left.reason,'blocked');
});

test('access diagnostics distinguish distance, obstacles, isolated roads and valid access without adding failed links',()=>{
 const scene=fixture([[[0,20],[80,20]],[[140,100],[180,100]]],[{id:'near',entrance:[20,25]},{id:'blocked',entrance:[60,40]},{id:'far',entrance:[50,80]},{id:'island',entrance:[160,100]}]);
 scene.zones=[{kind:'water',points:[[55,25],[65,25],[65,35],[55,35]]}];
 const net=Network.buildNetwork(scene),d=net.accessDiagnostics;
 assert.equal(d.near.reason,'connected');assert.equal(d.near.distance,5);
 assert.equal(d.blocked.reason,'blocked');assert.equal(d.blocked.distance,20);
 assert.equal(d.far.reason,'too-far');assert.equal(d.far.distance,60);
 assert.equal(d.island.reason,'disconnected');assert.deepEqual(d.far.roadPoint,[50,20]);
 assert.ok(!net.links.some(l=>['blocked','far'].includes(l.id)));assert.equal(net.access.far,null);
 assert.equal(Network.buildNetwork(fixture([],[])).accessDiagnostics.entry.reason,'no-roads');
});

test('crossing road interiors create a real shortest path', () => {
  assert.equal(typeof Network.buildNetwork, 'function');
  const net = Network.buildNetwork(fixture([[[0,20],[80,20]],[[40,0],[40,80]]], [
    {id:'a',x:70,y:20,width:2,depth:2,entrance:[70,20]},
    {id:'b',x:40,y:60,width:2,depth:2,entrance:[40,60]}
  ]));
  const route = Network.route(net,net.access.a,net.access.b);
  assert.equal(Math.round(route.distance),70);
  assert.ok(route.points.some(p => p[0] === 40 && p[1] === 20));
});
test('disconnected components and faraway entrances remain unreachable', () => {
  assert.equal(typeof Network.buildNetwork, 'function');
  const net = Network.buildNetwork(fixture([[[0,20],[25,20]],[[70,80],[95,80]]], [
    {id:'a',entrance:[10,20]}, {id:'b',entrance:[80,80]}, {id:'far',entrance:[50,50]}
  ]));
  assert.equal(Network.route(net,net.access.a,net.access.b),null);
  assert.equal(net.connected.a,true);
  assert.equal(net.connected.b,false);
  assert.equal(net.access.far,null);
});
test('entrance access adds the actual connection distance to travel', () => {
  assert.equal(typeof Network.buildNetwork, 'function');
  const net = Network.buildNetwork(fixture([[[0,20],[80,20]]], [{id:'a',entrance:[60,30]}]));
  assert.equal(Math.round(Network.route(net,net.access.entry,net.access.a).distance),70);
});
test('an entrance cannot connect through its building or a water body',()=>{
  const building={id:'a',x:50,y:35,width:20,depth:20,rotation:0};
  const scene=fixture([[[0,20],[90,20]]],[building]);
  assert.equal(Network.buildNetwork(scene).access.a,null);
  scene.buildings=[{id:'a',entrance:[50,40]}];scene.zones=[{kind:'water',points:[[30,25],[70,25],[70,35],[30,35]]}];
  assert.equal(Network.buildNetwork(scene).access.a,null);
});
test('dense intersections are rejected before graph resources grow without bound',()=>{
  let seed=1;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const roads=Array.from({length:150},()=>[[random()*100,random()*100],[random()*100,random()*100]]);
  assert.throws(()=>Network.buildNetwork(fixture(roads)),/复杂|简化/);
});
