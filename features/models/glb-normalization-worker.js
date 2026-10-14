/* CPU model inspection runs outside the page's rendering thread. */
importScripts('glb-normalization.js?v=20261013-student-models');
self.onmessage=event=>{
  try {
    const result=event.data.operation==='inspect'
      ? self.GlbNormalizationModule.inspectGlb(event.data.buffer)
      : self.GlbNormalizationModule.normalizeGlb(event.data.buffer,event.data.options);
    self.postMessage({result},result.buffer?[result.buffer]:[]);
  } catch(error) {self.postMessage({error:String(error.message||error)});}
};
