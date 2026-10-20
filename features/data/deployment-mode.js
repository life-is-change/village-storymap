(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DeploymentModeModule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SOURCE = Object.freeze({mode:'source',stage:'live',instanceId:'supabase-rzmbmwauomzwiyenafha',apiBase:null,releaseId:'source'});
  const token = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
  function resolveDeployment(config, origin) {
    const value = config === undefined ? SOURCE : config;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null && Object.prototype.toString.call(value) !== '[object Object]' ||
        Object.keys(value).some(key => !Object.keys(SOURCE).includes(key) && key !== 'auth') ||
        !['source','aliyun'].includes(value.mode) || !['candidate','live'].includes(value.stage) || !token(value.instanceId) || !token(value.releaseId)) throw Error('INVALID_DEPLOYMENT');
    if (value.mode === 'source') {
      if (value.apiBase !== null || value.instanceId !== SOURCE.instanceId || value.stage !== 'live' || value.auth !== undefined) throw Error('INVALID_DEPLOYMENT');
    } else {
      if (value.apiBase !== '/api/v1' || value.instanceId === SOURCE.instanceId) throw Error('INVALID_DEPLOYMENT');
      let url; try { url = new URL(origin); } catch { throw Error('INVALID_DEPLOYMENT'); }
      const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
      if (url.username || url.password || !['https:','http:'].includes(url.protocol)) throw Error('INVALID_DEPLOYMENT');
      if (url.protocol !== 'https:' && !local) throw Error('HTTPS_REQUIRED');
      if (value.auth !== undefined) {
        const auth=value.auth;
        if(!auth || Object.prototype.toString.call(auth)!=='[object Object]' || Object.keys(auth).sort().join(',')!=='mode,path,publicKey,version' ||
           auth.version!==1 || auth.mode!=='local' || auth.path!=='/auth/v1' || auth.publicKey!=='village-local-public-v1' ||
           !local && url.origin!=='https://8.148.248.237') throw Error('INVALID_DEPLOYMENT');
      }
    }
    return Object.freeze({...value,...(value.auth!==undefined?{auth:Object.freeze({...value.auth})}:{})});
  }
  function cacheKey(deployment, kind, identity) {
    const fields = ['userId','teachingProjectId','villageId','spaceId'];
    if (!token(deployment?.instanceId) || !token(kind) || !identity || fields.some(key => typeof identity[key] !== 'string' || !identity[key] || identity[key].length > 200 || /[\x00-\x1f\x7f]/.test(identity[key]))) throw Error('INVALID_CACHE_IDENTITY');
    return 'village:' + JSON.stringify([deployment.mode,deployment.instanceId,kind,...fields.map(key => identity[key])]);
  }
  return {resolveDeployment,cacheKey};
});
