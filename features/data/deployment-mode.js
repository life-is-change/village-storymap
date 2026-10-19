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
        Object.keys(value).some(key => !Object.keys(SOURCE).includes(key)) ||
        !['source','aliyun'].includes(value.mode) || !['candidate','live'].includes(value.stage) || !token(value.instanceId) || !token(value.releaseId)) throw Error('INVALID_DEPLOYMENT');
    if (value.mode === 'source') {
      if (value.apiBase !== null || value.instanceId !== SOURCE.instanceId || value.stage !== 'live') throw Error('INVALID_DEPLOYMENT');
    } else {
      if (value.apiBase !== '/api/v1' || value.instanceId === SOURCE.instanceId) throw Error('INVALID_DEPLOYMENT');
      let url; try { url = new URL(origin); } catch { throw Error('INVALID_DEPLOYMENT'); }
      const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
      if (url.username || url.password || !['https:','http:'].includes(url.protocol)) throw Error('INVALID_DEPLOYMENT');
      if (url.protocol !== 'https:' && !local) throw Error('HTTPS_REQUIRED');
    }
    return Object.freeze({...value});
  }
  function cacheKey(deployment, kind, identity) {
    const fields = ['userId','teachingProjectId','villageId','spaceId'];
    if (!token(deployment?.instanceId) || !token(kind) || !identity || fields.some(key => typeof identity[key] !== 'string' || !identity[key] || identity[key].length > 200 || /[\x00-\x1f\x7f]/.test(identity[key]))) throw Error('INVALID_CACHE_IDENTITY');
    return 'village:' + JSON.stringify([deployment.mode,deployment.instanceId,kind,...fields.map(key => identity[key])]);
  }
  return {resolveDeployment,cacheKey};
});
