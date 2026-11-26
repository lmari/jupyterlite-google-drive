import {Signal} from '@lumino/signaling';
import {notebookName, validateNotebook} from './drive-api.js';

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
  }
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.#generation++;
    this.#entries.clear();
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
      return {name:'',path:'',type:'directory',writable:false,created:epoch,last_modified:epoch,
        mimetype:null,format:options.content === false ? null : 'json',
        content:options.content === false ? null : [...this.#entries].map(([p,e]) =>
          this.#model(p,{modifiedTime:e.modified,capabilities:{canEdit:e.canEdit}})),size:null};
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
  async delete() { throw unavailable(); }
  async rename() { throw unavailable(); }
  async copy() { throw unavailable(); }
  async getDownloadUrl() { throw unavailable(); }
}
