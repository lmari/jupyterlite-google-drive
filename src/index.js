import {showDialog, Dialog, InputDialog} from '@jupyterlab/apputils';
import {PageConfig} from '@jupyterlab/coreutils';
import {IDocumentManager} from '@jupyterlab/docmanager';
import {IMainMenu} from '@jupyterlab/mainmenu';
import {INotebookTracker} from '@jupyterlab/notebook';
import {GoogleAuth} from './auth.js';
import {DriveAPI, notebookName} from './drive-api.js';
import {NativeDrive} from './native-drive.js';
import {dataPath, transferData} from './kernel-data.js';

const plugin = {
  id: 'jupyterlite-google-drive:plugin', autoStart: true,
  requires: [IDocumentManager, IMainMenu, INotebookTracker],
  activate(app, docs, menu, tracker) {
    const auth = new GoogleAuth({clientId: PageConfig.getOption('googleDriveClientId'),
      apiKey: PageConfig.getOption('googleDriveApiKey'), appId: PageConfig.getOption('googleDriveAppId')});
    const drive = new DriveAPI(() => auth.token());
    let links = new WeakMap(); let busy = false; let prepared = false; let preparationError = '';
    const tell = (title, body) => showDialog({title, body, buttons: [Dialog.okButton()]});
    const contents = app.serviceManager.contents;
    const native = new NativeDrive(drive);
    contents.addDrive(native);
    const nativePanels = new Set();
    const requireClosed = () => {
      if (nativePanels.size || native.hasPendingSave) throw new Error('Close all experimental Google Drive notebooks before reconnecting or disconnecting. Export unsaved work first.');
    };
    const confirmOutputDiscard = async () => {
      if (!native.hasOutputs) return true;
      const answer = await showDialog({
        title:'Discard temporary output files?',
        body:'Files under /drive/output exist only in this browser session. Export anything you need before reconnecting or disconnecting.',
        buttons:[Dialog.cancelButton(),Dialog.warnButton({label:'Discard'})]
      });
      return answer.button.accept;
    };
    const current = () => {
      const panel = tracker.currentWidget;
      if (!panel || app.shell.currentWidget !== panel) throw new Error('Select an open notebook first.');
      return panel;
    };
    const run = fn => async () => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (e) { await tell('Google Drive', String(e.message || e)); }
      finally { busy = false; }
    };
    const add = (name, label, fn) => {
      const id = 'jupyterlite-google-drive:' + name;
      app.commands.addCommand(id, {label, execute: run(fn)});
      return {command: id};
    };
    const connect = add('connect', 'Google Drive: Connect', async () => {
      if (!prepared) throw new Error(preparationError || 'Google libraries are loading. Retry shortly.');
      requireClosed();
      if (!(await confirmOutputDiscard())) return;
      await auth.connect(); links = new WeakMap(); native.reset();
      await tell('Google Drive', 'Connected. Choose Open from Drive or Save a new copy to Drive.');
    });
    const openRemote = async id => {
      const {meta, content} = await drive.read(id);
      // Unique local copy: never overwrite a local notebook with the same name.
      const temp = await contents.newUntitled({type: 'notebook'});
      await contents.save(temp.path, {type: 'notebook', format: 'json', content});
      const panel = docs.openOrReveal(temp.path, 'Notebook');
      if (!panel) throw new Error('Local copy created, but editor could not open it.');
      await panel.context.ready;
      links.set(panel, {id: meta.id, name: meta.name, version: meta.version});
      await tell('Google Drive', `Opened ${meta.name} as ${temp.path}. Use Google Drive: Save to original to update the cloud file.`);
    };
    const open = add('open', 'Google Drive: Open notebook', async () => {
      const id = await auth.pick(); if (id) await openRemote(id);
    });
    const browse = add('browse', 'Google Drive: Browse authorized notebooks', async () => {
      const files = await drive.listNotebooks();
      if (!files.length) {
        await tell('Google Drive', 'No authorized notebooks found. Use Google Drive: Open notebook to select a file in Google Picker, or Save a new copy to create one.');
        return;
      }
      // A numbered label is unique even if names and timestamps are identical.
      const items = files.map((file, i) => {
        const date = file.modifiedTime ? ' | ' + new Date(file.modifiedTime).toLocaleString() : '';
        const access = file.capabilities?.canEdit === false ? ' | read-only' : '';
        return `${i + 1}. ${file.name}${date}${access}`;
      });
      const result = await InputDialog.getItem({
        title: 'Authorized Google Drive notebooks',
        label: 'Choose a notebook (most recently modified first)',
        items, editable: false, okLabel: 'Open'
      });
      if (!result.button.accept) return;
      const selected = files[items.indexOf(result.value)];
      if (selected) await openRemote(selected.id);
    });
    const nativeOpen = add('native-open', 'Google Drive: Open native notebook (experimental)', async () => {
      const answer = await showDialog({
        title: 'Experimental remote editor',
        body: 'This notebook opens directly on Google Drive. Standard save and JupyterLab autosave may write remotely. Checkpoints are available only in the current editor session; rename and delete are not implemented. You can make a local recovery copy without Google access. Use a disposable notebook only. Close it before switching accounts.',
        buttons: [Dialog.cancelButton(), Dialog.okButton({label:'Continue'})]
      });
      if (!answer.button.accept) return;
      const id = await auth.pick(); if (!id) return;
      const meta = await drive.metadata(id);
      if (meta.trashed || !/\.ipynb$/i.test(meta.name)) throw new Error('Select a non-trashed .ipynb file.');
      const path = native.mount(id, meta.name);
      const panel = docs.openOrReveal(native.name + ':' + path, 'Notebook');
      if (!panel) throw new Error('Could not open native notebook.');
      if (!nativePanels.has(panel)) {
        nativePanels.add(panel);
        // JupyterLab clears dirty on successful save, even if the editor
        // changed after the snapshot was taken. Compare to the uploaded bytes.
        const guardDirty = (_sender, state) => {
          if (state === 'completed' && !panel.isDisposed) {
            if (native.hasUnsavedChanges(path, panel.context.model.toJSON())) {
              panel.context.model.dirty = true;
            }
          } else if (state === 'failed' && !panel.isDisposed) {
            panel.context.model.dirty = true;
          }
        };
        panel.context.saveState.connect(guardDirty);
        panel.disposed.connect(() => {
          panel.context.saveState.disconnect(guardDirty);
          nativePanels.delete(panel);
          native.release(path);
        });
      }
      await panel.context.ready;
      await tell('Google Drive', 'Opened native notebook. Standard Save writes to Google Drive. For recovery, use Google Drive: Save local recovery copy.');
    });
    const save = add('save', 'Google Drive: Save to original', async () => {
      const panel = current(); const link = links.get(panel);
      if (!link) throw new Error('No remote link for this notebook. Reopen from Drive or save a new copy.');
      const answer = await showDialog({title: 'Update Google Drive?', body: `Overwrite ${link.name} with the current notebook?`, buttons: [Dialog.cancelButton(), Dialog.okButton()]});
      if (!answer.button.accept) return;
      await panel.context.ready;
      const meta = await drive.update(link.id, link.version, panel.context.model.toJSON());
      links.set(panel, {id: meta.id, name: meta.name, version: meta.version});
      await tell('Google Drive', `Saved ${meta.name}.`);
    });
    const saveAs = add('save-as', 'Google Drive: Save a new copy', async () => {
      const panel = current(); await panel.context.ready;
      const name = notebookName(panel.context.path.split('/').pop());
      const meta = await drive.create(name, panel.context.model.toJSON());
      links.set(panel, {id: meta.id, name: meta.name, version: meta.version});
      await tell('Google Drive', `Created ${meta.name} in My Drive.`);
    });
    const recover = add('recover', 'Google Drive: Save local recovery copy', async () => {
      const panel = current();
      await panel.context.ready;
      // Snapshot the live model, including unsaved edits; no API call or
      // remote credential is needed. Never overwrite an existing local file.
      const content = structuredClone(panel.context.model.toJSON());
      const temp = await contents.newUntitled({type:'notebook'});
      await contents.save(temp.path,{type:'notebook',format:'json',content});
      docs.openOrReveal(temp.path,'Notebook');
      await tell('Google Drive', `Local recovery copy saved as ${temp.path}. The original notebook was not changed.`);
    });
    const importData = add('import-data', 'Google Drive: Import data into Python', async () => {
      const panel = current();
      await panel.context.ready;
      const kernel = panel.sessionContext.session?.kernel;
      if (!kernel || kernel.name !== 'python' || kernel.status !== 'idle') {
        throw new Error('Select a notebook with a running, idle Pyodide Python kernel. Run a cell first if needed.');
      }
      const id = await auth.pick(); if (!id) return;
      const {meta,bytes} = await drive.readData(id);
      const path = dataPath(meta.name);
      const answer = await showDialog({
        title:'Import data into Python?',
        body:`Copy ${meta.name} (${bytes.byteLength} bytes) to ${path} in this notebook's running Python kernel? It is a temporary snapshot, lost when the kernel is restarted, and changes will not be uploaded to Google Drive.`,
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Import'})]
      });
      if (!answer.button.accept) return;
      if (panel.isDisposed || panel.sessionContext.session?.kernel !== kernel) {
        throw new Error('The original Python kernel changed. Retry from the notebook.');
      }
      await transferData(kernel,meta.name,bytes);
      await tell('Google Drive', `Data available in Python at ${path}. Example: open("${path}", "rb"). Temporary copy only; no synchronization.`);
    });
    const mountData = add('mount-data', 'Google Drive: Mount read-only data file (experimental)', async () => {
      const panel = current();
      await panel.context.ready;
      if (!panel.context.path.startsWith(native.name + ':')) throw new Error('Open a native Google Drive notebook first. For local notebooks, use Import data into Python.');
      const id = await auth.pick(); if (!id) return;
      const meta = await drive.metadata(id);
      const answer = await showDialog({
        title:'Mount read-only data?',
        body:`Expose ${meta.name} to native Google Drive notebooks in this browser session? Reads retrieve the file from Google Drive. Writes are disabled. Python filesystem access requires JupyterLite filesystem synchronization; if unavailable use Import data into Python.`,
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Mount'})]
      });
      if (!answer.button.accept) return;
      const path = native.mountData(meta);
      await tell('Google Drive', `Mounted /drive/${path}. In a native notebook with filesystem synchronization enabled, use open("/drive/${path}", "rb"). Mounts expire on reconnect or refresh.`);
    });
    const exportData = add('export-data', 'Google Drive: Export Python output as new file', async () => {
      const paths = native.listOutputs();
      if (!paths.length) throw new Error('No output files. In a native notebook with filesystem synchronization, write a file under /drive/output/ first.');
      const result = await InputDialog.getItem({title:'Choose Python output',label:'Temporary files shared by native notebooks in this browser session',items:paths,editable:false,okLabel:'Select'});
      if (!result.button.accept) return;
      const {name,bytes} = native.outputSnapshot(result.value);
      const answer = await showDialog({title:'Create new file on Google Drive?',
        body:`Upload ${name} (${bytes.length} bytes) to My Drive? This creates a new file and never overwrites an existing Drive file. The temporary source remains available.`,
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Upload'})]});
      if (!answer.button.accept) return;
      const meta = await drive.createData(name,bytes);
      await tell('Google Drive',`Created ${meta.name} in My Drive.`);
    });
    const disconnect = add('disconnect', 'Google Drive: Disconnect', async () => {
      requireClosed();
      if (!(await confirmOutputDiscard())) return;
      auth.disconnect(); links = new WeakMap(); native.reset();
      await tell('Google Drive', 'Disconnected. Local notebook copies remain in this browser.');
    });
    menu.fileMenu.addGroup([connect, open, browse, nativeOpen, save, saveAs, recover, importData, mountData, exportData, disconnect], 80);
    // Load external scripts only if configured; connect itself remains a user gesture.
    void auth.prepare().then(() => {prepared = true;}).catch(e => {preparationError = String(e.message || e);});
  }
};
export default plugin;
