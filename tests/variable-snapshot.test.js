import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSnapshot,inspectVariables,maxReply} from '../src/variable-snapshot.js';

const payload={rows:[{name:'dati',type:'list',value:'[2, 4]'}],total:1};
const message='JUPYTERLITE_VARIABLES_V1:'+JSON.stringify(payload)+'\n';
test('parses only bounded structured snapshot output',()=>{
  assert.deepEqual(parseSnapshot('other stream\n'+message),payload);
  assert.throws(()=>parseSnapshot('unrelated output'));
  assert.throws(()=>parseSnapshot('x'.repeat(maxReply+1)));
  assert.throws(()=>parseSnapshot('JUPYTERLITE_VARIABLES_V1:'+JSON.stringify({rows:[{name:'x',type:'int',value:1}],total:1})));
});
test('requests an explicit snapshot only on idle Python and captures its stdout',async()=>{
  let options;
  const kernel={name:'python',status:'idle',requestExecute(o){
    options=o;
    const f={};
    f.done=Promise.resolve().then(()=>{
      f.onIOPub({header:{msg_type:'stream'},content:{name:'stdout',text:message}});
      return {content:{status:'ok'}};
    });
    return f;
  }};
  assert.deepEqual(await inspectVariables(kernel),payload);
  assert.equal(options.store_history,false);
  assert.equal(options.allow_stdin,false);
  await assert.rejects(inspectVariables({...kernel,status:'busy'}),/idle/);
});
