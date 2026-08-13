(function exposePhotoMaterialBridge(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhotoMaterialBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPhotoMaterialBridge() {
  const REQUEST_TYPE = 'village-house-generator:request-photo-materials';
  const RESPONSE_TYPE = 'village-house-generator:photo-materials';

  function normalizePhotoMaterials(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        id: String(item?.id ?? '').trim(),
        url: String(item?.url || item?.photo_url || '').trim(),
        uploadedAt: String(item?.uploadedAt || item?.uploaded_at || item?.created_at || '').trim(),
        uploadedBy: String(item?.uploadedBy || item?.uploaded_by || '').trim()
      }))
      .filter((item) => {
        if (!item.url) return false;
        const key = item.id ? `id:${item.id}` : `url:${item.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0));
  }

  function getPhotoFileMetadata(photo, responseType) {
    const supportedType = ['image/jpeg', 'image/png'].includes(String(responseType || '').toLowerCase())
      ? String(responseType).toLowerCase()
      : '';
    let baseName = '';
    try {
      const pathname = new URL(String(photo?.url || ''), 'http://localhost').pathname;
      baseName = decodeURIComponent(pathname.split('/').pop() || '');
    } catch (_) {}
    baseName = baseName.replace(/[\\/:*?"<>|]/g, '-');
    const extensionMatch = baseName.match(/\.(jpe?g|png)$/i);
    const extensionType = extensionMatch
      ? (extensionMatch[1].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg')
      : '';
    const type = supportedType || extensionType || 'image/jpeg';
    if (!extensionMatch) {
      const extension = type === 'image/png' ? 'png' : 'jpg';
      baseName = `building-photo-${String(photo?.id || 'existing').trim() || 'existing'}.${extension}`;
    }
    return { name: baseName, type };
  }

  return { REQUEST_TYPE, RESPONSE_TYPE, normalizePhotoMaterials, getPhotoFileMetadata };
});
