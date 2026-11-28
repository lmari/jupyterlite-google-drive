// An explicit, bounded snapshot of the current IPython namespace.
export const maxRows=100;
export const maxReply=120000;
const prefix='JUPYTERLITE_VARIABLES_V1:';
// Execute in a separate dictionary so helper names never enter user_ns.
// Avoid calling repr/str on arbitrary objects, iterating arbitrary containers,
// or evaluating user expressions. The Pyodide kernel may record this request
// in IPython history despite store_history:false.
export const snapshotCode = String.raw`__import__('builtins').exec("""
import builtins as b
import json
import itertools

def preview(value, depth=0):
    t = b.type(value)
    if t is b.str:
        return b.repr(value[:100]) + ('…' if b.len(value) > 100 else '')
    if t is b.bytes:
        return b.repr(value[:40]) + ('…' if b.len(value) > 40 else '')
    if t is b.int:
        return b.str(value) if value.bit_length() <= 256 else '<large integer>'
    if t in (b.float, b.complex, b.bool, b.type(None)):
        return b.repr(value)
    if t in (b.list, b.tuple, b.dict, b.set, b.frozenset):
        n = b.len(value)
        if depth:
            return '<' + t.__name__ + ', ' + b.str(n) + ' items>'
        if t in (b.list, b.tuple):
            opening, closing = ('[', ']') if t is b.list else ('(', ')')
            items = [preview(x, 1) for x in value[:5]]
            return opening + ', '.join(items) + (', …' if n > 5 else '') + closing
        return '<' + t.__name__ + ', ' + b.str(n) + ' items>'
    return '<object>'

def snapshot(ns):
    rows = []
    total = 0
    for name, value in ns.items():
        if b.type(name) is not b.str or name.startswith('_') or name in ('In','Out','get_ipython','exit','quit','open'):
            continue
        total += 1
        if b.len(rows) >= 100:
            continue
        try:
            kind = b.type.__getattribute__(b.type(value), '__name__')
            if b.type(kind) is not b.str:
                kind = 'object'
            text = preview(value)
        except Exception:
            kind, text = 'object', '<unavailable>'
        rows.append({'name':name[:160], 'type':kind[:100], 'value':text[:240]})
    rows.sort(key=lambda r:r['name'])
    b.print('JUPYTERLITE_VARIABLES_V1:' + json.dumps({'rows':rows,'total':total},ensure_ascii=True))

snapshot(ns)
""", {'ns': __import__('IPython').get_ipython().user_ns})`;

export function parseSnapshot(text){
  if(typeof text!=='string'||text.length>maxReply)throw new Error('Variable snapshot exceeds its size limit.');
  const line=text.split(/\r?\n/).find(x=>x.startsWith(prefix));
  if(!line)throw new Error('The Python kernel did not return a variable snapshot.');
  const data=JSON.parse(line.slice(prefix.length));
  if(!Array.isArray(data?.rows)||data.rows.length>maxRows||
     !Number.isSafeInteger(data.total)||data.total<data.rows.length||
     data.rows.some(r=>!r||typeof r.name!=='string'||r.name.length>320||
       typeof r.type!=='string'||r.type.length>200||typeof r.value!=='string'||r.value.length>480))
    throw new Error('Invalid variable snapshot.');
  return data;
}
export async function inspectVariables(kernel){
  if(!kernel||kernel.isDisposed||kernel.name!=='python'||kernel.status!=='idle')
    throw new Error('Start the Pyodide Python kernel and wait until it is idle.');
  const future=kernel.requestExecute({code:snapshotCode,silent:false,store_history:false,allow_stdin:false,stop_on_error:true});
  let text='',overflow=false;
  future.onIOPub=msg=>{
    if(msg.header.msg_type==='stream'&&msg.content.name==='stdout'){
      const part=String(msg.content.text);
      if(text.length+part.length>maxReply)overflow=true;
      else if(!overflow)text+=part;
    }
  };
  const reply=await future.done;
  if(reply.content.status!=='ok')throw new Error('Python could not inspect the current namespace.');
  if(overflow)throw new Error('Variable snapshot exceeds its size limit.');
  return parseSnapshot(text);
}
