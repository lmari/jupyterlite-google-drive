import {maxDataBytes,validDataName,dataMimeType,validateDataMetadata} from './drive-api.js';
import {toBase64} from './kernel-data.js';

// Private transport namespace, never included in the directory listing.
// A writable Python stream owns a snapshot, remote ID and version until close.
export const writeNamespace='__jupyterlite_write__';
const error=(code,message)=>Object.assign(new Error(message),{code});
const fail=()=>error('EIO','Google Drive folder or authorization changed.');
const epoch='1970-01-01T00:00:00.000Z';
const controlModel=(path,value)=>({name:path.split('/').pop(),path,type:'file',
  writable:false,created:epoch,last_modified:epoch,mimetype:'application/json',
  format:'json',content:value,size:null});
export class RemoteWrites {
  #parent=null;
  #generation=0;
  #handles=new Map();
  #pending=0;
  constructor(api,onCommit) {this.api=api;this.onCommit=onCommit;}
  get pending() {return this.#pending>0;}
  setFolder(parent) {
    if(parent!==this.#parent) {
      this.#parent=parent;
      this.#generation++;
      this.#handles.clear();
    }
  }
  reset() {this.#parent=null;this.#generation++;this.#handles.clear();}
  #assertCurrent(parent,generation) {
    if(!parent||parent!==this.#parent||generation!==this.#generation) throw fail();
  }
  #handle(token) {
    const h=this.#handles.get(token);
    if(!h) throw fail();
    this.#assertCurrent(h.parent,h.generation);
    return h;
  }
  #sizeLimit(token,bytes) {
    const total=[...this.#handles].reduce((n,[key,h])=>n+(key===token?0:h.bytes.length),0)+bytes.length;
    if(bytes.length>maxDataBytes||total>4*maxDataBytes)
      throw error('EFBIG','Remote write limit: 5 MiB per file, 20 MiB across open handles.');
  }
  async #begin(token,flags,name) {
    if(!validDataName(name)||['data','output',writeNamespace].includes(name))
      throw error('EINVAL','Invalid or reserved datafile name.');
    if(!Number.isSafeInteger(flags)||![1,2].includes(flags&3)) throw error('EINVAL','Invalid write mode.');
    if(this.#handles.has(token)||this.#handles.size>=32) throw error('EBUSY','Too many open remote file handles.');
    const parent=this.#parent,generation=this.#generation;
    this.#assertCurrent(parent,generation);
    this.#pending++;
    try {
      const matches=(await this.api.listFolder(parent)).filter(f=>f.name===name);
      this.#assertCurrent(parent,generation);
      if(matches.length>1) throw error('EEXIST','Ambiguous Google Drive filename.');
      const entry=matches[0];
      if(entry&&(flags&64)&&(flags&128)) throw error('EEXIST','File already exists.');
      if(!entry&&!(flags&64)) throw error('ENOENT','Remote file does not exist.');
      let meta=null,bytes=new Uint8Array();
      if(entry) {
        const result=await this.api.readData(entry.id);
        meta=validateDataMetadata(result.meta);
        if(meta.capabilities?.canEdit===false) throw error('EACCES','Remote file is read-only.');
        if(meta.name!==name||meta.id!==entry.id) throw fail();
        if(!(flags&512)) bytes=result.bytes;
      }
      this.#assertCurrent(parent,generation);
      if(!meta&&[...this.#handles.values()].some(h=>!h.meta&&h.parent===parent&&h.name===name))
        throw error('EEXIST','A new file with this name is already open for writing.');
      if(this.#handles.has(token)||this.#handles.size>=32) throw error('EBUSY','Too many open remote file handles.');
      this.#sizeLimit(token,bytes);
      this.#handles.set(token,{parent,generation,name,meta,bytes:bytes.slice(),committing:false});
    } finally {this.#pending--;}
  }
  async #commit(token) {
    const h=this.#handle(token);
    if(h.committing) throw error('EBUSY','Remote save already running.');
    h.committing=true;this.#pending++;
    try {
      const matches=(await this.api.listFolder(h.parent)).filter(f=>f.name===h.name);
      this.#assertCurrent(h.parent,h.generation);
      let uploaded;
      if(h.meta) {
        if(matches.length!==1||matches[0].id!==h.meta.id) throw fail();
        uploaded=await this.api.updateData(h.meta.id,h.meta.version,h.bytes);
      } else {
        if(matches.length) throw error('EEXIST','A file with this name was created in the meantime.');
        uploaded=await this.api.createData(h.name,h.bytes,h.parent);
      }
      this.#assertCurrent(h.parent,h.generation);
      if(!uploaded?.id||!uploaded.version) throw fail();
      const meta={...(h.meta||{mimeType:dataMimeType(h.name),capabilities:{canEdit:true}}),
        ...uploaded,name:h.name,size:String(h.bytes.length)};
      this.onCommit(h.parent,meta,!!h.meta);
    } finally {
      this.#pending--;
      this.#handles.delete(token);
    }
  }
  async get(path,options={}) {
    const parts=path.split('/');
    if(parts.length===1||parts.length===2&&!parts[1])
      return {name:writeNamespace,path:writeNamespace,type:'directory',writable:false,
        created:epoch,last_modified:epoch,mimetype:null,format:'json',content:options.content===false?null:[],size:null};
    const [,op,token,flags,encoded]=parts;
    if(['begin','commit','cancel'].includes(op)) {
      let result={ok:true};
      try {
        if(!/^[a-f0-9-]{36}$/i.test(token||'')) throw error('EINVAL','Invalid handle.');
        if(op==='begin') {
          if(parts.length!==5) throw error('EINVAL','Invalid open request.');
          await this.#begin(token,Number(flags),decodeURIComponent(encoded));
        } else if(op==='commit') await this.#commit(token);
        else if(!this.#handles.get(token)?.committing) this.#handles.delete(token);
      } catch(e) {result={ok:false,code:e.code||'EIO',message:String(e.message||e)};}
      return controlModel(path,result);
    }
    if(parts.length!==2) throw fail();
    const h=this.#handle(op);
    return {name:op,path,type:'file',writable:true,created:epoch,last_modified:epoch,
      mimetype:'application/octet-stream',format:options.content===false?null:'base64',
      content:options.content===false?null:toBase64(h.bytes),size:h.bytes.length};
  }
  save(path,options={}) {
    const parts=path.split('/');
    if(parts.length!==2) throw fail();
    const token=parts[1],h=this.#handle(token);
    if(h.committing||options.type!=='file'||typeof options.content!=='string') throw fail();
    let bytes;
    if(options.format==='base64') {
      if(options.content.length>4*Math.ceil(maxDataBytes/3)) throw error('EFBIG','Remote file exceeds 5 MiB.');
      bytes=Uint8Array.from(atob(options.content),c=>c.charCodeAt(0));
    } else if(options.format==='text') bytes=new TextEncoder().encode(options.content);
    else throw error('EINVAL','Unsupported data format.');
    this.#sizeLimit(token,bytes);
    h.bytes=bytes;
    return this.get(path,{content:false});
  }
}

// Installed inside the actual Pyodide worker after mounting DriveFS. No
// replacement of Python open(), no credentials or network access in Python.
// The private virtual file carries a unique handle through the existing
// ContentsManager transport. All uploads happen on commit at stream close.
export function installRemoteWriteStreams(drive) {
  const FS=drive.FS, ns='/drive/__jupyterlite_write__';
  const open=FS.open.bind(FS), close=drive.stream_ops.close.bind(drive.stream_ops);
  const modes={r:0,'r+':2,w:577,'w+':578,a:1089,'a+':1090,x:193,'x+':194};
  const err=code=>new FS.ErrnoError(drive.ERRNO_CODES[code]||drive.ERRNO_CODES.EIO);
  const control=path=>{
    const f=drive.API.get(ns+'/'+path);
    const result=JSON.parse(new TextDecoder().decode(f.data));
    if(!result.ok) {
      console.warn('Google Drive:',result.message);
      throw err(result.code);
    }
  };
  const cancel=token=>{try {control('cancel/'+token);}catch{}};
  FS.open=function(path,flags,mode) {
    const n=typeof flags==='string'?modes[flags]:flags;
    let absolute;
    if(typeof path==='string'&&path) {
      absolute=drive.PATH.normalize(path.startsWith('/')?path:drive.PATH.join2(FS.cwd(),path));
    } else if(path&&typeof path==='object') absolute=FS.getPath(path);
    const name=absolute?.startsWith('/drive/')?absolute.slice(7):'';
    if(!name||name.includes('/')||![1,2].includes(n&3))
      return open(path,flags,mode);
    const token=globalThis.crypto.randomUUID();
    control('begin/'+token+'/'+n+'/'+encodeURIComponent(name));
    try {
      // The staged file is already created/truncated according to the real flags.
      // Do not let the upstream FS truncate a remote object before version capture.
      return open(ns+'/'+token,n&~(64|128|512),mode);
    } catch(e) {cancel(token);throw e;}
  };
  drive.stream_ops.close=function(stream) {
    const path=drive.realPath(stream.node);
    if(!path.startsWith(ns+'/')) return close(stream);
    const token=path.slice(ns.length+1);
    try {
      close(stream); // stage exact bytes via the existing base64 Contents transport
      control('commit/'+token);
    } catch(e) {cancel(token);throw e;}
  };
}
