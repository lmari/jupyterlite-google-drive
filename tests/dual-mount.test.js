import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bootstrap,installDualMount} from '../src/dual-mount.js';
test('wraps Python factories once and bootstraps each new kernel before user code',async()=>{
  const calls=[],specs={factories:new Map(),changed:{connect(fn){this.fn=fn}}};
  specs.factories.set('python',async()=>({executeRequest:async c=>{calls.push(c);return {status:'ok'}}}));
  installDualMount(specs);
  const wrapped=specs.factories.get('python');specs.changed.fn();
  assert.equal(specs.factories.get('python'),wrapped);
  const a=await wrapped({}),b=await wrapped({});
  await a.executeRequest({code:'1'});await a.executeRequest({code:'2'});await b.executeRequest({code:'3'});
  assert.deepEqual(calls.map(c=>c.code),[bootstrap,'1','2',bootstrap,'3']);
  assert.equal(calls[0].silent,true);
});
test('failed setup cannot silently execute using the wrong mount',async()=>{
  const specs={factories:new Map([['python',async()=>({executeRequest:async()=>({status:'error'})})]]),changed:{connect(){}}};
  installDualMount(specs);
  assert.equal((await (await specs.factories.get('python')({})).executeRequest({code:'1'})).status,'error');
});
