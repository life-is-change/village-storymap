export function invalid() { return Object.assign(new Error('INVALID_INPUT'), {code:'INVALID_INPUT',status:400}); }
export function parseSpaceQuery(params) {
  for (const key of params.keys()) if (!['kind','limit','offset'].includes(key) || params.getAll(key).length !== 1) throw invalid();
  const kind = params.get('kind') ?? 'group';
  if (!['group','personal'].includes(kind)) throw invalid();
  const number = (key, fallback, min, max) => {
    const raw = params.get(key) ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw invalid();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid();
    return value;
  };
  return {kind,limit:number('limit',50,1,100),offset:number('offset',0,0,10000)};
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSpaceId(kind,id) {
  if (!['group','personal'].includes(kind) || typeof id !== 'string' || !id.length || id.length > 200 || /[\x00-\x1f\x7f/\\]/.test(id) || id === '.' || id === '..' || (kind === 'personal' && !UUID.test(id))) throw invalid();
  return id;
}
export function publicError(code,requestId) { return {error:{code,requestId}}; }
