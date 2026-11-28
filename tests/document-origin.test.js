import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentOrigin,decorateDocument} from '../src/document-origin.js';
test('storage indicator reflects actual path, link and authorization',()=>{
  assert.equal(documentOrigin('demo.ipynb',false,'connected'),'local');
  assert.equal(documentOrigin('data.csv',true,'connected'),'linked');
  assert.equal(documentOrigin('data.csv',true,'expired'),'linked-offline');
  assert.equal(documentOrigin('GoogleDrive:uuid--demo.ipynb',false,'connected'),'remote');
});
test('decoration preserves title label and unrelated metadata, updates caption without duplication',()=>{
  const title={label:'dati.csv',dataset:{id:'widget'},caption:'File: dati.csv',icon:'file'};
  decorateDocument(title,'linked');
  assert.equal(title.label,'dati.csv');assert.equal(title.icon,'file');
  assert.deepEqual(title.dataset,{id:'widget','drive-origin':'linked'});
  assert.match(title.caption,/standard Save is local/);
  decorateDocument(title,'local');decorateDocument(title,'local');
  assert.equal(title.caption.split('\n').length,2);
  assert.match(title.caption,/browser storage/);
});
