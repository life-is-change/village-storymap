import test from 'node:test';import assert from 'node:assert/strict';import {assetInput} from './fixtures/scene-files.mjs';
const mod=await import('../scene-files/uploads.mjs').catch(()=>({}));
test('registration metadata cannot smuggle other file paths or caller identities',()=>{
 assert.equal(typeof mod.parseCommitInput,'function');
 assert.equal(mod.parseCommitInput({displayName:'Bench',license:'student-provided',metadata:{category:'bench'}}).displayName,'Bench');
 for(const metadata of [{lowStoragePath:'other/file.glb'},{inspection:{uri:'https://example.invalid/a'}},{originalStoragePath:'../../a'},{ownerId:'fake'}])assert.throws(()=>mod.parseCommitInput({displayName:'Bench',license:'student-provided',metadata}));
});
test('idempotency digest ignores object property order but detects differing contents',()=>{
 assert.equal(typeof mod.requestDigest,'function');assert.equal(mod.requestDigest({a:1,b:2}),mod.requestDigest({b:2,a:1}));assert.notEqual(mod.requestDigest({a:1}),mod.requestDigest({a:2}));
});
