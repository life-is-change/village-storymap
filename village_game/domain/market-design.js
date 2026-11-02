(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.VillageMarketDesign=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // All dimensions are metres. The broad central lane stays clear of goods.
 function stalls(width,depth){
  if(!Number.isFinite(width)||!Number.isFinite(depth)||width<9||depth<10)return [];
  const result=[],styles=[['canopy',2.4,1.5,2.4],['ground',1.6,1.1,.3],['table',3.4,1.2,.85]],kinds=['vegetables','fruit','vegetables','tofu'];
  for(let row=0;row<2;row++){let cursor=-width/2+1.8,index=0;
   while(index<12){const [style,w,d,h]=styles[(index+row)%3];if(cursor+w>width/2-1.8)break;
    result.push({id:'stall-'+result.length,x:cursor+w/2,y:(row?1:-1)*(depth/2-2),width:w,depth:d,height:h,style,produceKind:kinds[(index+row)%4],headingDeg:row?0:180});cursor+=w+.6;index++;
   }
  }
  return result;
 }
 function world(b,p){const angle=(b.rotation||0)*Math.PI/180;return [b.x+p[0]*Math.cos(angle)-p[1]*Math.sin(angle),b.y+p[0]*Math.sin(angle)+p[1]*Math.cos(angle)];}
 function geometry(b){const row=stalls(b.width,b.depth);return {field:{type:'Polygon',coordinates:[[[-b.width/2,-b.depth/2],[b.width/2,-b.depth/2],[b.width/2,b.depth/2],[-b.width/2,b.depth/2],[-b.width/2,-b.depth/2]].map(p=>world(b,p))]},gate:world(b,[b.width/2-.6,-b.depth/2+.4]),stalls:row.map(s=>({...s,id:b.id+':'+s.id,center:world(b,[s.x,s.y]),headingDeg:s.headingDeg-(b.rotation||0),footprint:[s.width,s.depth]}))};}
 return {VERSION:'daily-market-design-1',stalls,world,geometry};
});
