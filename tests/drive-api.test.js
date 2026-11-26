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
  const {api}=mock({status:401,body:{}}); await assert.rejects(api.metadata('abc'),/401.*Renew Google Drive authorization/);
});

test('lists all authorized notebook pages, filtering Google-native and other files',async()=>{
  const {api,calls}=mock(
    {files:[meta,{id:'x',name:'data.csv'},{id:'folder',name:'fake.ipynb',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:'next+/'},
    {files:[{id:'xyz',name:'SECOND.IPYNB',mimeType:'application/json'},meta]}
  );
  const files=await api.listNotebooks();
  assert.deepEqual(files.map(f=>f.id),['abc','xyz']);
  assert.equal(new URL(calls[0].url).searchParams.get('q'),'trashed = false');
  assert.equal(new URL(calls[1].url).searchParams.get('pageToken'),'next+/');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer fake-token');
});
test('returns an empty list when no authorized notebooks exist',async()=>{
  const {api}=mock({files:[]}); assert.deepEqual(await api.listNotebooks(),[]);
});
test('rejects incomplete or looping Drive pagination',async()=>{
  const {api}=mock({files:[],incompleteSearch:true}); await assert.rejects(api.listNotebooks(),/incomplete/);
  const loop=mock({files:[],nextPageToken:'repeat'},{files:[],nextPageToken:'repeat'});
  await assert.rejects(loop.api.listNotebooks(),/repeated/);
});
test('does not silently hide authorization failures while listing',async()=>{
  const {api}=mock({status:401,body:{}}); await assert.rejects(api.listNotebooks(),/401.*Renew Google Drive authorization/);
});

test('downloads binary data without JSON conversion and checks version',async()=>{
  const dataMeta={...meta,name:'dati.csv',mimeType:'text/csv',size:'4'};
  const calls=[];
  const api=new DriveAPI(()=>'fake-token',async(url,opts)=>{
    calls.push(url);
    return url.includes('alt=media')?new Response(Uint8Array.of(0,255,1,2)):Response.json(dataMeta);
  });
  const result=await api.readData('abc');
  assert.deepEqual([...result.bytes],[0,255,1,2]);assert.equal(calls.length,3);
});
test('rejects native Google files, notebooks, oversize data and changed versions',async()=>{
  for(const extra of [{name:'test.ipynb',mimeType:'application/json'},{name:'Sheet',mimeType:'application/vnd.google-apps.spreadsheet'},{name:'large.csv',mimeType:'text/csv',size:'5242881'}]){
    const {api,calls}=mock({...meta,...extra});await assert.rejects(api.readData('abc'));assert.equal(calls.length,1);
  }
  const m={...meta,name:'dati.csv',mimeType:'text/csv'};
  const {api}=mock(m,{value:3},{...m,version:'2'});
  await assert.rejects(api.readData('abc'),/changed/);
});
test('enforces download limit even when Drive metadata does not report size',async()=>{
  const m={...meta,name:'dati.bin',mimeType:'application/octet-stream'};
  const api=new DriveAPI(()=>'fake-token',async url=>url.includes('alt=media')?new Response(new Uint8Array(5242881)):Response.json(m));
  await assert.rejects(api.readData('abc'),/5 MiB/);
});

test('creates a new binary Drive file via multipart POST, never PATCH',async()=>{
  let request;
  const api=new DriveAPI(()=>'fake-token',async(url,options)=>{
    request={url,options};
    return Response.json({id:'new-id',name:'result.bin'});
  });
  const result=await api.createData('result.bin',Uint8Array.of(0,255,128,65));
  assert.equal(result.id,'new-id');assert.equal(request.options.method,'POST');
  assert.match(request.url,/uploadType=multipart/);
  assert.equal(request.options.headers.Authorization,'Bearer fake-token');
  const body=new Uint8Array(await request.options.body.arrayBuffer());
  assert.ok(body.some((v,i)=>v===0&&body[i+1]===255&&body[i+2]===128&&body[i+3]===65));
  assert.match(new TextDecoder().decode(body),/"name":"result.bin"/);
  await assert.rejects(api.createData('../bad',Uint8Array.of()),/Invalid/);
  await assert.rejects(api.createData('bad.ipynb',Uint8Array.of()),/Invalid/);
});
