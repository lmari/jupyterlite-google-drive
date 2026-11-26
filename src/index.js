import {showDialog, Dialog, InputDialog} from '@jupyterlab/apputils';
import {PageConfig} from '@jupyterlab/coreutils';
import {IDocumentManager} from '@jupyterlab/docmanager';
import {IMainMenu} from '@jupyterlab/mainmenu';
import {INotebookTracker} from '@jupyterlab/notebook';
import {GoogleAuth} from './auth.js';
import {DriveAPI, notebookName} from './drive-api.js';
import {NativeDrive} from './native-drive.js';

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
      if (nativePanels.size) throw new Error('Close all experimental Google Drive notebooks before reconnecting or disconnecting. Export unsaved work first.');
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
        body: 'This notebook opens directly on Google Drive. Standard save and JupyterLab autosave may write remotely. Checkpoints, rename, delete and offline recovery are not implemented. Use a disposable notebook only. Close it before switching accounts.',
        buttons: [Dialog.cancelButton(), Dialog.okButton({label:'Continue'})]
      });
      if (!answer.button.accept) return;
      const id = await auth.pick(); if (!id) return;
      const meta = await drive.metadata(id);
      if (meta.trashed || !/\\.ipynb$/i.test(meta.name)) throw new Error('Select a non-trashed .ipynb file.');
      const path = native.mount(id, meta.name);
      const panel = docs.openOrReveal(native.name + ':' + path, 'Notebook');
      if (!panel) throw new Error('Could not open native notebook.');
      nativePanels.add(panel);
      panel.disposed.connect(() => nativePanels.delete(panel));
      await panel.context.ready;
      await tell('Google Drive', 'Opened native notebook. Standard Save writes to Google Drive. For recovery, use Save a new copy or copy cells into a local notebook.');
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
    const disconnect = add('disconnect', 'Google Drive: Disconnect', async () => {
      requireClosed();
      auth.disconnect(); links = new WeakMap(); native.reset();
      await tell('Google Drive', 'Disconnected. Local notebook copies remain in this browser.');
    });
    menu.fileMenu.addGroup([connect, open, browse, nativeOpen, save, saveAs, disconnect], 80);
    // Load external scripts only if configured; connect itself remains a user gesture.
    void auth.prepare().then(() => {prepared = true;}).catch(e => {preparationError = String(e.message || e);});
  }
};
export default plugin;
