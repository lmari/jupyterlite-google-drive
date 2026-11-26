import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDependencies,makeManifest,addDependency,removeDependency,dependencyStatus} from '../src/dependencies.js';
import {NativeDrive} from '../src/native-drive.js';
const dep={path:'data/dati.csv',file_id:'file-1'};
const meta={id:'file-1',name:'renamed.csv',mimeType:'text/csv',version:'1',size:'4'};
test('manifest preserves alias and strips extraneous fields',()=>{
  assert.deepEqual(makeManifest([{...dep,token:'ignored'}]),{version:1,dependencies:[dep]});
  assert.deepEqual(validateDependencies(undefined),[]);
  for(const d of [{...dep,path:'data/../x'},{...dep,path:'output/a'},{...dep,path:'data/a.ipynb'},{...dep,file_id:'https://example.com' }]){
    assert.throws(()=>makeManifest([d]),/Invalid/);
  }
  assert.throws(()=>makeManifest([dep,dep]),/duplicate/);
  assert.throws(()=>validateDependencies({version:2,dependencies:[dep]}),/Unsupported/);
});
test('restore checks metadata and preserves a declared alias even after remote rename',async()=>{
  const d=new NativeDrive({metadata:async id=>{assert.equal(id,dep.file_id);return meta;}});
  assert.deepEqual(await d.restoreDependencies(makeManifest([dep])),['data/dati.csv']);
  assert.deepEqual(d.dependencyManifest(),makeManifest([dep]));
  await assert.rejects(d.restoreDependencies(makeManifest([{...dep,file_id:'other'}])),/collision/);
});
test('failed or inaccessible dependency cannot partially mount earlier references',async()=>{
  const d=new NativeDrive({metadata:async id=>{if(id!=='file-1')throw Error('403');return meta;}});
  await assert.rejects(d.restoreDependencies(makeManifest([dep,{path:'data/other.csv',file_id:'other'}])),/403/);
  assert.deepEqual(d.listData(),[]);
});
test('reset invalidates in-flight restore',async()=>{
  let finish;
  const d=new NativeDrive({metadata:()=>new Promise(r=>{finish=r;})});
  const p=d.restoreDependencies(makeManifest([dep]));d.reset();finish(meta);
  await assert.rejects(p,/authorization changed/);
  assert.deepEqual(d.listData(),[]);
});

test('individual dependency selection preserves unrelated and currently unmounted references',()=>{
  const existing=makeManifest([dep]);
  const second={path:'data/other.csv',file_id:'file-2'};
  assert.deepEqual(addDependency(existing,second),makeManifest([dep,second]));
  assert.deepEqual(addDependency(existing,dep),existing);
  assert.deepEqual(removeDependency(addDependency(existing,second),dep.path),makeManifest([second]));
  assert.deepEqual(existing,makeManifest([dep]));
});
test('dependency selection refuses replacement of an existing alias with a different file',()=>{
  const existing=makeManifest([dep]);
  assert.throws(()=>addDependency(existing,{...dep,file_id:'other'}),/another file/);
  assert.equal(dependencyStatus(dep,[]),'not-mounted');
  assert.equal(dependencyStatus(dep,[dep]),'mounted');
  assert.equal(dependencyStatus(dep,[{...dep,file_id:'other'}]),'collision');
});
test('adding one reference enforces manifest size and valid paths',()=>{
  const full=makeManifest(Array.from({length:20},(_,i)=>({path:'data/file'+i+'.csv',file_id:'id-'+i})));
  assert.throws(()=>addDependency(full,dep),/Unsupported/);
  assert.throws(()=>addDependency(undefined,{path:'data/../bad',file_id:'id'}),/Invalid/);
});
