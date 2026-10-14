(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ModelViewMetricsModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function measureModelView(Cesium,viewer,position,radius){
  const empty={distance:Infinity,pixels:0,inView:false};if(!viewer?.camera||!position||!Cesium?.Cartesian3?.distance)return empty;
  const camera=viewer.camera,canvas=viewer.scene?.canvas||{},width=canvas.clientWidth||canvas.width||1,height=canvas.clientHeight||canvas.height||1;
  const origin=camera.positionWC||camera.position;if(!origin)return empty;
  const distance=Math.max(.01,Cesium.Cartesian3.distance(origin,position));radius=Math.max(.1,Number(radius)||1);
  let pixels=2*radius*height/(2*Math.tan((camera.frustum?.fovy||Math.PI/3)/2)*distance);
  if(camera.frustum?.getPixelDimensions&&Cesium.Cartesian2){const dim=camera.frustum.getPixelDimensions(width,height,distance,1,new Cesium.Cartesian2());if(dim.y>0)pixels=2*radius/dim.y;}
  let inView=true;const project=Cesium.SceneTransforms?.worldToWindowCoordinates||Cesium.SceneTransforms?.wgs84ToWindowCoordinates;
  if(project){const p=project(viewer.scene,position);inView=!!p&&p.x>=-pixels/2&&p.x<=width+pixels/2&&p.y>=-pixels/2&&p.y<=height+pixels/2;}
  if(camera.directionWC&&Number.isFinite(origin.x)&&Number.isFinite(position.x)){const d=camera.directionWC;const dot=(position.x-origin.x)*d.x+(position.y-origin.y)*d.y+(position.z-origin.z)*d.z;if(dot<-radius)inView=false;}
  return {distance,pixels:Number.isFinite(pixels)?pixels:0,inView};
 }
 return {measureModelView};
});
