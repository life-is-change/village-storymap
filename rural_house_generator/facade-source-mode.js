(function exposeFacadeSourceMode(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FacadeSourceMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function facadeSourceModeFactory() {
  const SOURCES = Object.freeze({
    local_worker: {
      label: '工作站自动处理',
      description: '上传原始实拍图，由 4090 工作站自动生成标准正立面。'
    },
    external_prompt: {
      label: '外部 AI 辅助',
      description: '复制提示词到豆包，完成后把标准正立面结果上传回来。'
    },
    cloud_api: {
      label: '云端 API',
      description: '由平台服务端调用千问处理；需要管理员配置密钥和预算。'
    }
  });

  function normalizeSource(value) {
    return Object.hasOwn(SOURCES, value) ? value : 'local_worker';
  }

  function sourceFromParams(params) {
    return normalizeSource(String(params?.get?.('facadeSource') || ''));
  }

  function canSubmit(source, capability = {}) {
    const normalized = normalizeSource(source);
    if (normalized === 'cloud_api') return Boolean(capability.available);
    return true;
  }

  function cloudUnavailableMessage(capability = {}) {
    if (capability.available) return '';
    return capability.reason === 'budget_disabled'
      ? '本课程的云端处理预算已关闭。'
      : '管理员尚未配置云端图像处理。';
  }

  return { SOURCES, normalizeSource, sourceFromParams, canSubmit, cloudUnavailableMessage };
});
