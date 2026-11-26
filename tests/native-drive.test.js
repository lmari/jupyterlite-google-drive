import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeDrive} from '../src/native-drive.js';
const nb={nbformat:4,nbformat_minor:5,cells:[],metadata:{}};
const create = () => {
  let version=1, writes=0;
  const meta=()=>({id:'a',name:'test.ipynb',version:String(version),modifiedTime:'2026-01-01T00:00:00Z',capabilities:{canEdit:true}});
  const api={metadata:async()=>meta(),read:async()=>({meta:meta(),content:nb}),update:async(id,v,content)=>{
    if(v!==String(version))throw Error('changed');writes++;version++;return meta();
  }};
  return {api,bump:()=>version++,writes:()=>writes};
};
test('native mount reads then saves, emits save event and updates baseline',async()=>{
  const fake=create(), d=new NativeDrive(fake.api), p=d.mount('a','a.ipynb');
  assert.equal(d.mount('a','a.ipynb'),p);
  const model=await d.get(p);assert.equal(model.type,'notebook');assert.deepEqual(model.content,nb);
  let emitted=0;d.fileChanged.connect(()=>emitted++);
  await d.save(p,{content:nb});await d.save(p,{content:nb});
  assert.equal(fake.writes(),2);assert.equal(emitted,2);
});
test('native metadata and content reads do not adopt a newer remote baseline',async()=>{
  const fake=create(), d=new NativeDrive(fake.api), p=d.mount('a','a.ipynb');
  await d.get(p);fake.bump();
  await assert.rejects(d.get(p,{content:false}),/changed/);
  await assert.rejects(d.get(p),/changed/);
  await assert.rejects(d.save(p,{content:nb}),/changed/);
  assert.equal(fake.writes(),0);
});
test('native paths are invalid after reconnect, unsupported operations fail closed',async()=>{
  const fake=create(), d=new NativeDrive(fake.api), p=d.mount('a','a.ipynb');
  await d.get(p);d.reset();
  await assert.rejects(d.save(p,{content:nb}),/not mounted/);
  await assert.rejects(d.createCheckpoint(p),/not mounted/);
  await assert.rejects(d.delete(p),e=>e.response.status===403);
  assert.equal(fake.writes(),0);
});
test('native mount rejects a save before loading a baseline',async()=>{
  const fake=create(), d=new NativeDrive(fake.api), p=d.mount('a','a.ipynb');
  await assert.rejects(d.save(p,{content:nb}),/not supported/);
  assert.equal(fake.writes(),0);
});

test('closing a native editor allows reopening with a fresh baseline',async()=>{
  const fake=create(), d=new NativeDrive(fake.api), p=d.mount('a','a.ipynb');
  await d.get(p);d.release(p);fake.bump();
  const next=d.mount('a','a.ipynb');assert.notEqual(next,p);
  await d.get(next);await d.save(next,{content:nb});assert.equal(fake.writes(),1);
});
test('releasing an editor does not permit account switch during pending save',async()=>{
  const fake=create();let finish;
  const orig=fake.api.update;fake.api.update=async(...args)=>{await new Promise(r=>{finish=r;});return orig(...args);};
  const d=new NativeDrive(fake.api),p=d.mount('a','a.ipynb');await d.get(p);
  const saving=d.save(p,{content:nb});d.release(p);
  assert.equal(d.hasPendingSave,true);assert.throws(()=>d.reset(),/current/);
  assert.throws(()=>d.mount('a','a.ipynb'),/progress/);
  finish();await saving;assert.equal(d.hasPendingSave,false);d.reset();
});

test('native upload tracks the actual snapshot, including edits made during the request',async()=>{
  const fake=create();let finish;
  const orig=fake.api.update;fake.api.update=async(...args)=>{await new Promise(r=>{finish=r;});return orig(...args);};
  const d=new NativeDrive(fake.api),p=d.mount('a','a.ipynb');
  await d.get(p);
  const draft=structuredClone(nb);
  const saving=d.save(p,{content:draft});
  draft.metadata.changed=true;
  finish();await saving;
  assert.equal(d.hasUnsavedChanges(p,nb),false);
  assert.equal(d.hasUnsavedChanges(p,draft),true);
});
test('failed save does not claim that newer edits were saved',async()=>{
  const fake=create(),d=new NativeDrive(fake.api),p=d.mount('a','a.ipynb');
  await d.get(p);await d.save(p,{content:nb});
  fake.bump();
  const draft={...nb,metadata:{newEdit:true}};
  await assert.rejects(d.save(p,{content:draft}),/changed/);
  assert.equal(d.hasUnsavedChanges(p,draft),true);
});

test('native checkpoints snapshot last persisted content, not live edits, without a remote write',async()=>{
  const fake=create(),d=new NativeDrive(fake.api),p=d.mount('a','a.ipynb');
  await d.get(p);
  assert.deepEqual(await d.listCheckpoints(p),[]);
  const cp=await d.createCheckpoint(p);
  assert.deepEqual(await d.listCheckpoints(p),[cp]);
  assert.equal(fake.writes(),0);
  const draft={...nb,metadata:{edit:true}};
  await d.save(p,{content:draft});
  assert.equal(fake.writes(),1);
  await d.restoreCheckpoint(p,cp.id);
  assert.equal(fake.writes(),2);
  assert.equal(d.hasUnsavedChanges(p,nb),false);
  assert.equal(d.hasUnsavedChanges(p,draft),true);
  await d.deleteCheckpoint(p,cp.id);
  assert.deepEqual(await d.listCheckpoints(p),[]);
});
test('checkpoint restore refuses a stale remote version and checkpoints expire with the handle',async()=>{
  const fake=create(),d=new NativeDrive(fake.api),p=d.mount('a','a.ipynb');
  await d.get(p);
  const cp=await d.createCheckpoint(p);
  fake.bump();
  await assert.rejects(d.restoreCheckpoint(p,cp.id),/changed/);
  assert.equal(fake.writes(),0);
  d.release(p);
  const next=d.mount('a','a.ipynb');await d.get(next);
  assert.deepEqual(await d.listCheckpoints(next),[]);
});

const csvMeta={id:'csv-id',name:'dati.csv',mimeType:'text/csv',size:'4',version:'1'};
test('mount read-only data aliases and return bytes via contents base64 format',async()=>{
  let content=Uint8Array.of(0,255,1,2);
  const api={metadata:async()=>csvMeta,readData:async()=>({meta:csvMeta,bytes:content})};
  const d=new NativeDrive(api);
  assert.equal(d.mountData(csvMeta),'data/dati.csv');
  const root=await d.get('');
  assert.ok(root.content.some(x=>x.name==='data'&&x.type==='directory'));
  assert.equal((await d.get('data')).content[0].name,'dati.csv');
  const m=await d.get('data/dati.csv',{content:false});
  assert.equal(m.size,4);assert.equal(m.writable,false);assert.equal(m.content,null);
  assert.equal((await d.get('data/dati.csv')).content,'AP8BAg==');
  content=Uint8Array.of(4,5);
  assert.equal((await d.get('data/dati.csv')).content,'BAU=');
  await assert.rejects(d.save('data/dati.csv',{type:'file',content:'x'}),/not supported/);
  await assert.rejects(d.delete('data/dati.csv'),/not supported/);
  d.reset();assert.deepEqual((await d.get('data')).content,[]);
  await assert.rejects(d.get('data/dati.csv'),/not mounted/);
});
test('rejects invalid data mounts, collisions and stale in-flight read after reset',async()=>{
  let finish;
  const api={readData:()=>new Promise(r=>{finish=r;})};
  const d=new NativeDrive(api);d.mountData(csvMeta);
  assert.throws(()=>d.mountData({...csvMeta,id:'other'}),/different data file/);
  assert.throws(()=>d.mountData({...csvMeta,mimeType:'application/vnd.google-apps.spreadsheet'}),/regular data file/);
  const reading=d.get('data/dati.csv');d.reset();
  finish({meta:csvMeta,bytes:Uint8Array.of(1)});
  await assert.rejects(reading,/authorization changed/);
});
