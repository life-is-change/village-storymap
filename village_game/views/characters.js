(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageCharacters=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';const cache=new Map(),width=16,height=24;
 function cells(a,phase=0){
  const palette=a.kind==='visitor'?({family:['#8a6599','#b698be','#674a76'],overnight:['#b76d80','#dfa2ad','#884e63']}[a.profile]||['#bd783b','#e3b574','#895631']):a.ageGroup==='senior'?['#7f8d64','#b2bd92','#5c684b']:a.ageGroup==='child'?['#568aa6','#95bdd0','#3e647e']:['#4d8477','#91b7a0','#355c54'];
  const outline='#3d3733',hair=a.ageGroup==='senior'?'#c5c2b5':'#594538',hairLight=a.ageGroup==='senior'?'#eee8d6':'#836049',skin='#e5b48a',skinLight='#f6d2a8',skinShade='#c78968';
  const seated=['resting','eating','staying','home'].includes(a.state),working=['working','cooking'].includes(a.state),chat=a.interaction?.status==='active',moving=a.state==='moving',frame=moving?Math.floor(phase)%2:0;
  const r=[],add=(x,y,w,h,color)=>r.push({x,y,w,h,color}),drop=seated?3:0;
  // Original code-native pixel art. The last shoe row and contact shadow share y=24.
  // Keep that foot anchor fixed across walking frames and seated/working poses.
  add(3,23,10,1,'#403b3155');add(5,22,6,1,'#403b3128');
  if(a.kind==='visitor'){add(2,12+drop,3,6,outline);add(2,13+drop,2,4,'#c6a372');}
  add(5,1+drop,6,1,outline);add(4,2+drop,8,8,outline);add(5,10+drop,6,1,outline);
  add(5,3+drop,6,6,skin);add(5,4+drop,4,3,skinLight);add(10,5+drop,1,4,skinShade);add(6,9+drop,4,1,skinShade);
  add(5,2+drop,6,2,hair);add(5,2+drop,4,1,hairLight);add(4,4+drop,1,3,hair);add(11,4+drop,1,a.sex==='female'?6:3,hair);
  add(6,6+drop,1,2,outline);add(9,6+drop,1,2,outline);add(7,9+drop,2,1,'#9b604a');
  if(a.kind==='visitor'){add(4,1+drop,8,1,'#7e6648');add(5,0+drop,6,1,'#d8bb82');add(3,3+drop,10,1,'#e2c992');}
  add(6,11+drop,4,1,outline);add(7,11+drop,2,1,skin);
  add(4,12+drop,8,7-drop,outline);add(5,12+drop,6,6-drop,palette[0]);add(5,12+drop,2,4-drop,palette[1]);add(10,13+drop,1,5-drop,palette[2]);
  add(7,12+drop,2,1,'#f1e1bc');add(7,14+drop,1,1,palette[2]);add(7,16+drop,1,1,palette[2]);
  add(3,13+drop,2,5-drop,outline);add(3,14+drop,1,3-drop,palette[0]);add(3,17,2,2,skin);
  if(chat){add(11,11+drop,2,5,outline);add(12,10+drop,2,2,skinLight);add(11,12+drop,1,3,palette[0]);}
  else{add(11,13+drop,2,5-drop,outline);add(12,14+drop,1,3-drop,palette[2]);add(11,17,2,2,skin);}
  if(seated){add(3,19,10,2,outline);add(4,19,8,1,'#686b79');add(3,20,3,3,outline);add(10,20,3,3,outline);add(4,20,1,2,'#8c8e99');add(11,20,1,2,'#8c8e99');add(2,22,4,2,outline);add(10,22,4,2,outline);add(2,22,3,1,'#8c7153');add(10,22,3,1,'#8c7153');}
  else{add(5,19,3,4-frame,outline);add(8,19,3,3+frame,outline);add(6,19,1,3-frame,'#7b7f8b');add(9,19,1,2+frame,'#616570');add(4,22-frame,4,2,outline);add(8,21+frame,4,2,outline);add(4,22-frame,3,1,'#8c7153');add(8,21+frame,3,1,'#8c7153');}
  if(working){add(13,13,1,10,outline);add(13,14,1,8,'#b08c58');add(12,12,3,2,'#687968');add(12,12,2,1,'#a6b1a0');}
  if(a.state==='eating'){add(9,16,5,1,'#f1e2bb');add(10,17,3,2,'#9f7c52');add(11,17,1,1,'#d9c095');}
  if(a.state==='waiting'){add(14,3,1,3,'#bd783b');add(14,7,1,1,'#bd783b');}
  return r;
 }
 function draw(ctx,a,x,y,displayHeight=26,phase=0){const scale=displayHeight/height;for(const r of cells(a,phase)){ctx.fillStyle=r.color;ctx.fillRect(x+(r.x-width/2)*scale,y+(r.y-height)*scale,r.w*scale,r.h*scale);}}
 function image(a,phase=0){const r=cells(a,phase),key=JSON.stringify(r);if(!cache.has(key)){const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" width="'+width*2+'" height="'+height*2+'" shape-rendering="crispEdges">'+r.map(r=>'<rect x="'+r.x+'" y="'+r.y+'" width="'+r.w+'" height="'+r.h+'" fill="'+r.color+'"/>').join('')+'</svg>';cache.set(key,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));}return cache.get(key);}
 return {draw,image,cells,width,height};
});
