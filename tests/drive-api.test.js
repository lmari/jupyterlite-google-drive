import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DriveAPI, validateNotebook, notebookName} from '../src/drive-api.js';
const nb = {nbformat:4,nbformat_minor:5,metadata:{},cells:[]};
const meta = {id:'abc',name:'test.ipynb',version:'1',capabilities:{canEdit:true}};
function mock(...results) {
  const calls = [];
  const api = new DriveAPI(()=>'fake-token', async (url, opts) => {
    calls.push({url,opts}); assert.ok(results.length);
    const result = results.shift(); return new Response(JSON.stringify(result.body ?? result),{status:result.status ?? 200});
  });
  return {api,calls};
}
test('validates notebook and cleans name',()=>{
  assert.equal(validateNotebook(nb),nb); assert.throws(()=>validateNotebook({}));
  assert.equal(notebookName('a/b'),'a_b.ipynb'); assert.equal(notebookName('a.ipynb'),'a.ipynb');
});
test('reads notebook with bearer token and version check',async()=>{
  const {api,calls}=mock(meta,nb,meta); assert.deepEqual(await api.read('abc'),{meta,content:nb});
  assert.equal(calls[1].opts.headers.Authorization,'Bearer fake-token'); assert.match(calls[1].url,/alt=media/);
});
test('rejects concurrent changes during read',async()=>{
  const {api}=mock(meta,nb,{...meta,version:'2'}); await assert.rejects(api.read('abc'),/changed/);
});
test('rejects stale version without uploading',async()=>{
  const {api,calls}=mock({...meta,version:'2'}); await assert.rejects(api.update('abc','1',nb),/changed/); assert.equal(calls.length,1);
});
test('updates existing file via PATCH',async()=>{
  const {api,calls}=mock(meta,{...meta,version:'2'}); assert.equal((await api.update('abc','1',nb)).version,'2');
  assert.equal(calls[1].opts.method,'PATCH'); assert.deepEqual(JSON.parse(calls[1].opts.body),nb);
});
test('creates new file via multipart upload',async()=>{
  const {api,calls}=mock(meta); await api.create('test',nb); assert.equal(calls[0].opts.method,'POST');
  assert.match(calls[0].opts.body,/test\.ipynb/); assert.match(calls[0].opts.headers['Content-Type'],/multipart\/related/);
});
test('reports expired credentials',async()=>{
  const {api}=mock({status:401,body:{}}); await assert.rejects(api.metadata('abc'),/Reconnect/);
});
