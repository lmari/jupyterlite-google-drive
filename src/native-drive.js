import {Signal} from '@lumino/signaling';
import {notebookName, validateNotebook, validateDataMetadata, maxDataBytes} from './drive-api.js';

import {dataPath, toBase64} from './kernel-data.js';

const epoch = '1970-01-01T00:00:00.000Z';
const unavailable = () => Object.assign(new Error('Google Drive: this operation is not supported in the experimental notebook drive.'), {response:{status:403}});
const conflict = () => new Error('Remote file changed. Save a new copy or export locally, then reopen from Drive.');
const safeName = name => notebookName(name).replace(/[:%?#]/g, '_');

// Separate mount, only accessible for this authorization session. Each open
// handle has its own baseline; no metadata refresh can advance it.
export class NativeDrive {
  name = 'GoogleDrive';
  isDisposed = false;
  fileChanged = new Signal(this);
  #entries = new Map();
  #data = new Map();
  #outputs = new Map();
  #generation = 0;
  constructor(api) { this.api = api; }

  get hasPendingSave() { return [...this.#entries.values()].some(entry => entry.busy); }
  release(path) {
    const entry = this.#entries.get(path);
    if (!entry) return;
    if (entry.busy) entry.released = true;
    else this.#entries.delete(path);
  }
  reset() {
    if (this.hasPendingSave) throw new Error('Wait for the current Google Drive save to finish.');
    this.#generation++;
    this.#entries.clear();
    this.#data.clear();
    this.#outputs.clear();
  }
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.#generation++;
    this.#entries.clear();
    this.#data.clear();
    this.#outputs.clear();
    Signal.clearData(this);
  }
  mount(id, name) {
    if (this.isDisposed) throw new Error('Drive disposed.');
    // One handle per file per auth session, so openOrReveal does not create
    // independent contexts for the same remote object.
    for (const [path, entry] of this.#entries) if (entry.id === id) {
      if (entry.released) throw new Error('Previous save is still in progress.');
      return path;
    }
    const path = globalThis.crypto.randomUUID() + '--' + safeName(name);
    this.#entries.set(path, {id, name, version:null, modified:null, busy:false});
    return path;
  }
  // Explicitly authorized read-only data aliases, shared by native notebooks
  // within the current connection. Do not silently replace another file.
  mountData(meta) {
    if (this.isDisposed) throw new Error('Drive disposed.');
    validateDataMetadata(meta);
    if (!meta.id) throw new Error('Missing Drive file ID.');
    const path = 'data/' + dataPath(meta.name).split('/').pop();
    const previous = this.#data.get(path);
    if (previous && previous.id !== meta.id) throw new Error('A different data file already uses this name. Rename it in Google Drive before mounting.');
    this.#data.set(path, {id:meta.id,meta});
    return path;
  }
  #dataModel(path,meta,bytes=null) {
    const size = Number(meta.size);
    return {name:path.split('/').pop(),path,type:'file',writable:false,
      created:meta.modifiedTime || epoch,last_modified:meta.modifiedTime || epoch,
      mimetype:meta.mimeType,format:bytes === null ? null : 'base64',
      content:bytes === null ? null : toBase64(bytes),
      size:bytes === null ? (Number.isSafeInteger(size) && size >= 0 ? size : null) : bytes.byteLength};
  }
  #directory(path,content) {
    return {name:path,path,type:'directory',writable:false,created:epoch,last_modified:epoch,
      mimetype:null,format:content === null ? null : 'json',content,size:null};
  }
  async #getData(path, options) {
    const entry = this.#data.get(path);
    if (!entry || this.isDisposed) throw new Error('Data file is not mounted. Select it from Google Drive first.');
    const generation = this.#generation;
    const result = options.content === false
      ? {meta:validateDataMetadata(await this.api.metadata(entry.id)),bytes:null}
      : await this.api.readData(entry.id);
    if (this.isDisposed || generation !== this.#generation || this.#data.get(path) !== entry) throw new Error('Google Drive authorization changed; mount the data file again.');
    entry.meta = result.meta;
    return this.#dataModel(path,result.meta,result.bytes);
  }
  get hasOutputs() { return this.#outputs.size > 0; }
  listOutputs() { return [...this.#outputs.keys()]; }
  outputSnapshot(path) {
    const entry = this.#outputs.get(path);
    if (!entry || this.isDisposed) throw new Error('Output file is not available.');
    return {name:path.split('/').pop(),bytes:entry.bytes.slice()};
  }
  #outputModel(path, entry, withContent) {
    return {...this.#dataModel(path,{modifiedTime:entry.modified,size:entry.bytes.length,mimeType:'application/octet-stream'},
      withContent ? entry.bytes : null),writable:true};
  }
  #saveOutput(path, options) {
    if (this.isDisposed || !/^output\/[A-Za-z0-9_][A-Za-z0-9._-]{0,179}$/.test(path) ||
        /\.ipynb$/i.test(path) || (options.type && options.type !== 'file')) throw unavailable();
    const previous = this.#outputs.get(path);
    let bytes;
    if (options.content == null && !previous) bytes = new Uint8Array();
    else if (typeof options.content === 'string' && options.format === 'base64') {
      if (options.content.length > 4 * Math.ceil(maxDataBytes / 3)) throw new Error('Output exceeds 5 MiB.');
      bytes = Uint8Array.from(atob(options.content),c=>c.charCodeAt(0));
    } else if (typeof options.content === 'string' && options.format === 'text') {
      if (options.content.length > maxDataBytes) throw new Error('Output exceeds 5 MiB.');
      bytes = new TextEncoder().encode(options.content);
    } else throw unavailable();
    const total = [...this.#outputs.values()].reduce((sum,e)=>sum+e.bytes.length,0) - (previous?.bytes.length || 0) + bytes.length;
    if (bytes.length > maxDataBytes || total > 4*maxDataBytes || (!previous && this.#outputs.size >= 20)) {
      throw new Error('Output staging limit exceeded (5 MiB per file, 20 MiB total, 20 files).');
    }
    const entry = {bytes,modified:new Date().toISOString()};
    this.#outputs.set(path,entry);
    const model = this.#outputModel(path,entry,false);
    this.fileChanged.emit({type:previous?'save':'new',oldValue:null,newValue:model});
    return model;
  }
  #entry(path) {
    const entry = this.#entries.get(path);
    if (!entry || this.isDisposed) throw new Error('Remote notebook is not mounted. Connect and reopen it from Google Drive.');
    return entry;
  }
  #assertLive(path, entry, generation) {
    if (this.#generation !== generation || this.#entries.get(path) !== entry || this.isDisposed) {
      throw new Error('Google Drive authorization changed; reopen the notebook.');
    }
  }
  #model(path, meta, content = null) {
    const name = path.split('/').pop();
    return {name, path, type:'notebook', writable:meta.capabilities?.canEdit !== false,
      created:meta.createdTime || meta.modifiedTime || epoch,
      last_modified:meta.modifiedTime || epoch, mimetype:null,
      format:content === null ? null : 'json', content,
      size:null};
  }
  async get(path, options = {}) {
    if (!path || path === '/') {
      return this.#directory('',options.content === false ? null : [
        this.#directory('data',null),
        {...this.#directory('output',null),writable:true},
        ...[...this.#entries].map(([p,e]) => this.#model(p,{modifiedTime:e.modified,capabilities:{canEdit:e.canEdit}}))
      ]);
    }
    if (path === 'data' || path === 'data/') return this.#directory('data',
      options.content === false ? null : [...this.#data].map(([p,e]) => this.#dataModel(p,e.meta)));
    if (path.startsWith('data/')) return this.#getData(path,options);
    if (path === 'output' || path === 'output/') return {...this.#directory('output',options.content === false ? null : [...this.#outputs].map(([p,e])=>this.#outputModel(p,e,false))),writable:true};
    if (path.startsWith('output/')) {
      const entry = this.#outputs.get(path);
      if (!entry || this.isDisposed) throw new Error('Output file not found.');
      return this.#outputModel(path,entry,options.content !== false);
    }
    const entry = this.#entry(path);
    const generation = this.#generation;
    if (options.content === false) {
      const meta = await this.api.metadata(entry.id);
      this.#assertLive(path,entry,generation);
      if (meta.trashed || (entry.version && meta.version !== entry.version)) throw conflict();
      return this.#model(path,meta);
    }
    const {meta,content} = await this.api.read(entry.id);
    this.#assertLive(path,entry,generation);
    if (!meta.version || (entry.version && meta.version !== entry.version)) throw conflict();
    entry.version = meta.version;
    entry.modified = meta.modifiedTime;
    entry.canEdit = meta.capabilities?.canEdit;
    entry.savedSnapshot = JSON.stringify(content);
    return this.#model(path,meta,content);
  }
  // Compare with the actual uploaded snapshot, rather than a metadata refresh
  // or the possibly newer editor state when the request finishes.
  hasUnsavedChanges(path, content) {
    const entry = this.#entry(path);
    return entry.savedSnapshot === undefined || entry.savedSnapshot !== JSON.stringify(content);
  }
  async save(path, options = {}) {
    if (path.startsWith('output/')) return this.#saveOutput(path,options);
    if (path === 'data' || path.startsWith('data/')) throw unavailable();
    if (options.type && options.type !== 'notebook') throw unavailable();
    const entry = this.#entry(path);
    if (!entry.version || entry.canEdit === false) throw unavailable();
    if (entry.busy) throw new Error('A Google Drive save is already in progress.');
    const content = structuredClone(validateNotebook(options.content));
    const generation = this.#generation;
    entry.busy = true;
    try {
      // DriveAPI checks the current version before uploading. It is not atomic.
      // Account switches are blocked by the plugin while native editors are open.
      const meta = await this.api.update(entry.id,entry.version,content);
      this.#assertLive(path,entry,generation);
      if (!meta.version) throw new Error('Drive did not return a version; reopen before saving again.');
      entry.version = meta.version;
      entry.modified = meta.modifiedTime;
      entry.savedSnapshot = JSON.stringify(content);
      const model = this.#model(path,{...meta,capabilities:{canEdit:entry.canEdit}});
      this.fileChanged.emit({type:'save',oldValue:null,newValue:model});
      return model;
    } finally {
      entry.busy = false;
      if (entry.released) this.#entries.delete(path);
    }
  }
  // JupyterLab's normal Save command also creates a checkpoint.
  // Keep one real, session-only checkpoint of the last persisted content.
  // Creating it does not trigger a second network write.
  async listCheckpoints(path) {
    const entry = this.#entry(path);
    return entry.checkpoint ? [{...entry.checkpoint.model}] : [];
  }
  async createCheckpoint(path) {
    const entry = this.#entry(path);
    if (!entry.version || entry.savedSnapshot === undefined || entry.canEdit === false || entry.busy) throw unavailable();
    const model = {id:'session',last_modified:new Date().toISOString()};
    entry.checkpoint = {model, snapshot:entry.savedSnapshot};
    return {...model};
  }
  async deleteCheckpoint(path, id) {
    const entry = this.#entry(path);
    if (entry.checkpoint?.model.id !== id || entry.busy) throw unavailable();
    delete entry.checkpoint;
  }
  async restoreCheckpoint(path, id) {
    const entry = this.#entry(path);
    if (entry.checkpoint?.model.id !== id) throw unavailable();
    // An explicit restore is a remote write, with the same version guard as Save.
    await this.save(path,{content:JSON.parse(entry.checkpoint.snapshot)});
  }
  async newUntitled() { throw unavailable(); }
  async delete(path) {
    const entry = this.#outputs.get(path);
    if (!entry || this.isDisposed) throw unavailable();
    this.#outputs.delete(path);
    this.fileChanged.emit({type:'delete',oldValue:this.#outputModel(path,entry,false),newValue:null});
  }
  async rename() { throw unavailable(); }
  async copy() { throw unavailable(); }
  async getDownloadUrl() { throw unavailable(); }
}
