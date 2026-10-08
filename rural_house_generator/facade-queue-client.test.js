const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createFacadeQueueClient } = require('./facade-queue-client.js');

function fakeSupabase() {
  const fake = {
    rpcCalls: [],
    tableCalls: [],
    signedCalls: [],
    channelConfig: null,
    removed: null,
    rpc(name, args) {
      this.rpcCalls.push({ name, args });
      const data = name === 'submit_facade_run' ? 'run-1'
        : name === 'get_facade_worker_availability' ? { available: true, last_seen_at: 'now' }
        : true;
      return Promise.resolve({ data, error: null });
    },
    from(table) {
      const call = { table, filters: [], order: null, limit: null };
      this.tableCalls.push(call);
      const chain = {
        select: () => chain,
        eq: (key, value) => { call.filters.push([key, value]); return chain; },
        order: (key, options) => { call.order = [key, options]; return chain; },
        limit: (value) => { call.limit = value; return chain; },
        single: () => Promise.resolve({ data: { id: 'run-1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: { id: 'run-1' }, error: null }),
        then: (resolve) => resolve({ data: [{ artifact_type: 'rectified_preview' }], error: null })
      };
      return chain;
    },
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath, expiresIn) => {
          fake.signedCalls.push({ bucket, storagePath, expiresIn });
          return { data: { signedUrl: 'https://signed.example/preview' }, error: null };
        }
      })
    },
    channel(name) {
      const channel = {
        on: (_kind, config, callback) => { fake.channelConfig = { name, config, callback }; return channel; },
        subscribe: () => channel
      };
      return channel;
    },
    removeChannel(channel) { this.removed = channel; }
  };
  return fake;
}

test('submit sends photo id and never sends owner id or photo url', async () => {
  const fake = fakeSupabase();
  const client = createFacadeQueueClient(fake);
  const runId = await client.submit({
    courseId: 'course-1', spaceId: 'current', objectCode: 'B-1', photoId: 9,
    ownerId: 'must-not-send', photoUrl: 'https://must-not-send.example'
  });

  assert.equal(runId, 'run-1');
  assert.deepEqual(fake.rpcCalls[0], {
    name: 'submit_facade_run',
    args: { p_course_id: 'course-1', p_space_id: 'current', p_object_code: 'B-1', p_photo_id: 9 }
  });
});

test('confirm crop sends only whitelisted geometry values', async () => {
  const fake = fakeSupabase();
  const client = createFacadeQueueClient(fake);
  await client.confirmCrop('run-1', {
    cropTop: 0.18, roofType: 'gable', buildingWidth: 10, buildingDepth: 8,
    ownerId: 'must-not-send', arbitrary: true
  });

  assert.deepEqual(fake.rpcCalls[0], {
    name: 'confirm_facade_crop',
    args: {
      p_run_id: 'run-1', p_crop_top: 0.18, p_roof_type: 'gable',
      p_building_width: 10, p_building_depth: 8
    }
  });
});

test('worker availability comes from heartbeat rpc', async () => {
  const fake = fakeSupabase();
  const value = await createFacadeQueueClient(fake).getWorkerAvailability();

  assert.equal(value.available, true);
  assert.equal(fake.rpcCalls[0].name, 'get_facade_worker_availability');
});

test('failed run retry uses an owner-authorized rpc', async () => {
  const fake = fakeSupabase();
  await createFacadeQueueClient(fake).retryFailed('run-1');
  assert.deepEqual(fake.rpcCalls[0], {
    name: 'retry_failed_facade_run', args: { p_run_id: 'run-1' }
  });
});

test('artifact urls are short-lived signed urls', async () => {
  const fake = fakeSupabase();
  const client = createFacadeQueueClient(fake);

  assert.equal(await client.createArtifactUrl('user/run/preview.jpg'), 'https://signed.example/preview');
  assert.deepEqual(fake.signedCalls, [{
    bucket: 'facade-generation', storagePath: 'user/run/preview.jpg', expiresIn: 300
  }]);
});

test('subscription filters by run id and can unsubscribe', () => {
  const fake = fakeSupabase();
  const client = createFacadeQueueClient(fake);
  const callback = () => {};
  const unsubscribe = client.subscribe('run-1', callback);

  assert.equal(fake.channelConfig.config.table, 'facade_generation_runs');
  assert.equal(fake.channelConfig.config.filter, 'id=eq.run-1');
  assert.equal(fake.channelConfig.callback, callback);
  unsubscribe();
  assert.ok(fake.removed);
});

test('generator loads facade queue client before application module', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const queueClient = html.indexOf('facade-queue-client.js');
  const app = html.indexOf('app.js');
  assert.ok(queueClient >= 0);
  assert.ok(app > queueClient);
});
