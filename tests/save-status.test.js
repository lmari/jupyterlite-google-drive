import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeSave} from '../src/save-status.js';
const remote={isNative:true,auth:'connected',info:{loaded:true,writable:true,busy:false,lastSaved:'2026-01-01T10:00:00Z'}};
test('loaded remote snapshot is not reported as a successful upload',()=>{
  assert.equal(describeSave({...remote,info:{...remote.info,lastSaved:null}}).kind,'loaded');
  assert.equal(describeSave({...remote,info:null}).kind,'loading');
  assert.equal(describeSave(remote).kind,'saved');
});
test('pending write and later edits never report saved prematurely',()=>{
  assert.equal(describeSave({...remote,dirty:true,info:{...remote.info,busy:true}}).kind,'saving');
  assert.equal(describeSave({...remote,dirty:true}).kind,'dirty');
});
test('failure, authorization expiry and read-only have distinct labels',()=>{
  assert.equal(describeSave({...remote,failed:true,dirty:true}).kind,'failed');
  assert.equal(describeSave({...remote,auth:'expired'}).kind,'unavailable');
  assert.match(describeSave({...remote,dirty:true,auth:'expired'}).text,/authorization required/);
  assert.equal(describeSave({...remote,info:{...remote.info,writable:false}}).kind,'readonly');
});
test('local copy is never represented as saved to Google Drive',()=>{
  assert.equal(describeSave({linked:true}).kind,'local');
  assert.match(describeSave({linked:true}).text,/Save to original/);
  assert.equal(describeSave({dirty:true}).kind,'local-dirty');
});
