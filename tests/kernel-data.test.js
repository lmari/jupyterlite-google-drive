import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dataPath,toBase64,transferCode,transferData} from '../src/kernel-data.js';
test('uses a flat safe path and preserves binary bytes',()=>{
  assert.equal(dataPath('../a:b.csv'),'/tmp/jupyterlite-drive/_a_b.csv');
  assert.equal(dataPath('dati.csv'),'/tmp/jupyterlite-drive/dati.csv');
  assert.equal(toBase64(Uint8Array.of(0,255,128,65)),'AP+AQQ==');
  const {path,code}=transferCode('dati.csv',Uint8Array.of(0,255,128,65));
  assert.equal(path,'/tmp/jupyterlite-drive/dati.csv');
  assert.match(code,/path.open\("xb"\)/);
  assert.match(code,/AP\+AQQ==/);
});
test('transfers to an idle Python kernel without history or token',async()=>{
  let request;
  const kernel={name:'python',status:'idle',requestExecute:(options)=>{
    request=options;return {done:Promise.resolve({content:{status:'ok'}})};
  }};
  assert.equal(await transferData(kernel,'dati.csv',Uint8Array.of(42)),'/tmp/jupyterlite-drive/dati.csv');
  assert.equal(request.silent,true);assert.equal(request.store_history,false);
  assert.equal(request.allow_stdin,false);
  assert.doesNotMatch(request.code,/Bearer|access_token/);
  await assert.rejects(transferData({...kernel,status:'busy'},'x',Uint8Array.of()),/idle/);
  await assert.rejects(transferData({...kernel,name:'javascript'},'x',Uint8Array.of()),/Pyodide/);
});
test('reports collision without overwriting existing kernel file',async()=>{
  const kernel={name:'python',status:'idle',requestExecute:()=>({done:Promise.resolve({content:{status:'error',ename:'FileExistsError'}})})};
  await assert.rejects(transferData(kernel,'x',Uint8Array.of()),/already exists/);
});
