const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runtime(options = {}) {
  let listener, locked = false, releaseRead;
  const authUser = { id: 'user-a' };
  const profile = { id: 'user-a', student_id: 'a', display_name: 'A', role: 'student' };
  const read = new Promise(resolve => { releaseRead = resolve; });
  let queries = 0;
  const client = {
    auth: {
      onAuthStateChange(fn) { listener = fn; },
      async getSession() {
        if (options.sessionError) throw new Error('SESSION_NETWORK_FAILURE');
        if (options.emitDuringSession) {
          locked = true;
          await listener('SIGNED_IN', { user: authUser });
          locked = false;
        }
        return { data: { session: { user: authUser } } };
      }
    },
    from() {
      queries++;
      return { select() { return this; }, eq() { return this; }, async maybeSingle() {
        // PostgREST may need getSession while auth is invoking its subscriber.
        if (locked) return new Promise(() => {});
        if (options.holdProfile) await read;
        return { data: profile, error: null };
      } };
    }
  };
  const window = { VillageSupabaseClient: client, SupabaseAuthModel: {
    profileToLegacyUser(user, row) { return { authUserId: user.id, studentId: row.student_id, name: row.display_name, role: row.role }; }
  }, addEventListener() {}, dispatchEvent() {} };
  const sandbox = { window, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById() { return null; } }, console: { warn() {}, error() {} },
    CustomEvent: class {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../auth-system.js'), 'utf8'), sandbox);
  return { api: window.VillageAuth, emit: (...args) => listener(...args), releaseRead, getQueries: () => queries };
}

async function settles(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('AUTH_READY_STUCK')), 150);
    })]);
  } finally { clearTimeout(timer); }
}

test('session recovery releases the SDK callback before profile queries and platform ready resolves', async () => {
  const env = runtime({ emitDuringSession: true });
  await settles(env.api.ready);
  assert.equal(env.api.getCurrentUser().authUserId, 'user-a');
});

test('auth subscribers return synchronously and a pending profile cannot resurrect a signed-out user', async () => {
  const env = runtime({ holdProfile: true });
  const result = env.emit('SIGNED_IN', { user: { id: 'user-a' } });
  assert.equal(result, undefined, 'SDK subscriber must not await a Supabase request');
  await new Promise(resolve => setTimeout(resolve, 5));
  env.emit('SIGNED_OUT', null);
  env.releaseRead();
  await settles(env.api.ready);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(env.api.getCurrentUser(), null);
});

test('session recovery failure settles readiness instead of leaving the entry queue waiting forever', async () => {
  const env = runtime({ sessionError: true });
  await settles(env.api.ready);
  assert.equal(env.api.getCurrentUser(), null);
});
