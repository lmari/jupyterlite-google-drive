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
  await assert.rejects(d.createCheckpoint(p),e=>e.response.status===403);
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
