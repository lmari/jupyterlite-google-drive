import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteWrites,writeNamespace as ns} from '../src/remote-writes.js';
const token='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002';
const start=(r,t,flags,name='dati.txt')=>r.get(ns+'/begin/'+t+'/'+flags+'/'+encodeURIComponent(name)).then(m=>m.content);
const finish=(r,t)=>r.get(ns+'/commit/'+t).then(m=>m.content);
const stage=(r,t,text)=>r.save(ns+'/'+t,{type:'file',format:'text',content:text});
function fixture() {
  let meta=null,bytes=new Uint8Array(),writes=0;
  const api={
    listFolder:async()=>meta?[{...meta}]:[],
    readData:async()=>({meta:{...meta},bytes:bytes.slice()}),
    createData:async(name,content,parent)=>{
      assert.equal(parent,'folder');writes++;
      bytes=content.slice();meta={id:'remote',name,version:'1',mimeType:'text/plain',capabilities:{canEdit:true}};
      return {...meta};
    },
    updateData:async(id,v,content)=>{
      if(id!==meta.id||v!==meta.version) throw Error('changed');
      writes++;bytes=content.slice();meta={...meta,version:String(Number(meta.version)+1)};
      return {...meta};
    }
  };
  const changes=[],r=new RemoteWrites(api,(...args)=>changes.push(args));r.setFolder('folder');
  return {r,changes,text:()=>new TextDecoder().decode(bytes),writes:()=>writes,bump:()=>{meta.version=String(Number(meta.version)+1);}};
}
test('exclusive create is staged until close and cannot replace an existing name',async()=>{
  const f=fixture(),{r}=f;
  assert.equal((await start(r,token,193)).ok,true);
  assert.equal((await start(r,second,193)).code,'EEXIST');
  await stage(r,token,'hello');
  assert.equal(f.writes(),0);
  assert.equal((await finish(r,token)).ok,true);
  assert.equal(f.text(),'hello');assert.equal(f.changes.length,1);
  assert.equal((await start(r,second,193)).code,'EEXIST');
  assert.equal(f.writes(),1);
});
test('append and truncation capture independent versions; stale handle cannot overwrite',async()=>{
  const f=fixture(),{r}=f;
  await start(r,token,193);await stage(r,token,'one');await finish(r,token);
  assert.equal((await start(r,token,1089)).ok,true);
  assert.equal((await r.get(ns+'/'+token)).content,btoa('one'));
  assert.equal((await start(r,second,577)).ok,true);
  assert.equal((await r.get(ns+'/'+second)).content,'');
  await stage(r,second,'new');await finish(r,second);
  await stage(r,token,'one stale');
  assert.equal((await finish(r,token)).ok,false);
  assert.equal(f.text(),'new');assert.equal(f.writes(),2);
});
test('folder navigation invalidates open handles; disconnected or reserved paths cannot create',async()=>{
  const f=fixture(),{r}=f;
  assert.equal((await start(r,token,193,'output')).ok,false);
  assert.equal((await start(r,token,193)).ok,true);
  await stage(r,token,'unsaved');r.setFolder('other');
  assert.equal((await finish(r,token)).ok,false);assert.equal(f.writes(),0);
  r.reset();assert.equal((await start(r,token,193)).ok,false);
});
test('failed remote version check preserves existing bytes',async()=>{
  const f=fixture(),{r}=f;
  await start(r,token,193);await stage(r,token,'original');await finish(r,token);
  await start(r,token,577);await stage(r,token,'replacement');f.bump();
  assert.equal((await finish(r,token)).ok,false);
  assert.equal(f.text(),'original');assert.equal(f.writes(),1);
});
