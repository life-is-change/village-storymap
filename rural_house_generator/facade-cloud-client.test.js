const test = require('node:test');
const assert = require('node:assert/strict');
const { createFacadeCloudClient } = require('./facade-cloud-client.js');

test('invokes only the server function and never accepts a browser API key', async () => {
  const calls = [];
  const client = createFacadeCloudClient({ functions: { invoke: async (name, options) => {
    calls.push({ name, body: options.body });
    return { data: { available: false } };
  } } });
  await client.getCapability();
  await client.submit({ photoId: 7, courseId: 'c', spaceId: 's', objectCode: 'B1', apiKey: 'forbidden' });
  assert.deepEqual(calls[0], { name: 'facade-cloud', body: { action: 'capability' } });
  assert.equal('apiKey' in calls[1].body, false);
});
