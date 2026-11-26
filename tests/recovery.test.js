import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsLeaveWarning,notebookBackupBytes} from '../src/recovery.js';
test('warn about any dirty remote notebook, pending upload or temporary output',()=>{
  assert.equal(needsLeaveWarning(),false);
  for(const key of ['dirtyNative','pendingSave','temporaryOutputs'])
    assert.equal(needsLeaveWarning({[key]:true}),true);
});
test('recovery serializes complete notebook including Unicode and outputs',()=>{
  const nb={nbformat:4,metadata:{},cells:[{source:['caffè'],outputs:[{data:{'text/plain':'α'}}]}]};
  assert.deepEqual(JSON.parse(new TextDecoder().decode(notebookBackupBytes(nb))),nb);
});
