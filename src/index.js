import {showDialog, Dialog} from '@jupyterlab/apputils';
import {PageConfig} from '@jupyterlab/coreutils';
import {IDocumentManager} from '@jupyterlab/docmanager';
import {IMainMenu} from '@jupyterlab/mainmenu';
import {INotebookTracker} from '@jupyterlab/notebook';
import {GoogleAuth} from './auth.js';
import {DriveAPI, notebookName} from './drive-api.js';

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
      await auth.connect(); links = new WeakMap();
      await tell('Google Drive', 'Connected. Choose Open from Drive or Save a new copy to Drive.');
    });
    const open = add('open', 'Google Drive: Open notebook', async () => {
      const id = await auth.pick(); if (!id) return;
      const {meta, content} = await drive.read(id);
      // Unique local copy: never overwrite a local notebook with the same name.
      const temp = await contents.newUntitled({type: 'notebook'});
      await contents.save(temp.path, {type: 'notebook', format: 'json', content});
      const panel = docs.openOrReveal(temp.path, 'Notebook');
      if (!panel) throw new Error('Local copy created, but editor could not open it.');
      await panel.context.ready;
      links.set(panel, {id: meta.id, name: meta.name, version: meta.version});
      await tell('Google Drive', `Opened ${meta.name} as ${temp.path}. Use Google Drive: Save to original to update the cloud file.`);
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
      auth.disconnect(); links = new WeakMap();
      await tell('Google Drive', 'Disconnected. Local notebook copies remain in this browser.');
    });
    menu.fileMenu.addGroup([connect, open, save, saveAs, disconnect], 80);
    // Load external scripts only if configured; connect itself remains a user gesture.
    void auth.prepare().then(() => {prepared = true;}).catch(e => {preparationError = String(e.message || e);});
  }
};
export default plugin;
