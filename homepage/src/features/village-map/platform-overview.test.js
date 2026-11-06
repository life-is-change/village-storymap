import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewStats, CASE_STUDIES } from './platform-overview.js';
test('homepage shows real account count and area, and counts one plan per published village',()=>{
 const rows=overviewStats({registeredUsers:7,villageCount:3,areaSquareMeters:2000000,measuredVillages:3});
 assert.deepEqual(rows.map(r=>r.value),['3','7','3','约3,000亩']);
 assert.equal(overviewStats(null)[1].value,'—');
 assert.equal(overviewStats({registeredUsers:0,villageCount:4,areaSquareMeters:0,measuredVillages:0})[3].value,'待核算');
});
test('case studies use three distinct HTTPS source pages',()=>{
 assert.equal(CASE_STUDIES.length,3);
 assert.equal(new Set(CASE_STUDIES.map(c=>c.url)).size,3);
 assert.ok(CASE_STUDIES.every(c=>new URL(c.url).protocol==='https:'&&c.source&&c.title&&c.description));
});
