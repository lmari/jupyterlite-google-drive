import {showDialog, Dialog, InputDialog} from '@jupyterlab/apputils';
import {PageConfig} from '@jupyterlab/coreutils';
import {IDocumentManager} from '@jupyterlab/docmanager';
import {IMainMenu} from '@jupyterlab/mainmenu';
import {INotebookTracker} from '@jupyterlab/notebook';
import {Menu} from '@lumino/widgets';
import editingTools from './editing-tools.js';
import variableInspector from './variable-inspector.js';
import {GoogleAuth} from './auth.js';
import {DriveAPI, notebookName, folderMime, isTextDatafile, decodeTextData} from './drive-api.js';
import {NativeDrive} from './native-drive.js';
import {dataPath, transferData} from './kernel-data.js';
import {DriveSidebar} from './sidebar.js';
import {describeSave} from './save-status.js';
import {needsLeaveWarning,notebookBackupBytes,downloadBytes} from './recovery.js';
import {dependencyKey,validateDependencies,addDependency,removeDependency,dependencyStatus} from './dependencies.js';

const plugin = {
  id: 'jupyterlite-google-drive:plugin', autoStart: true,
  requires: [IDocumentManager, IMainMenu, INotebookTracker],
  activate(app, docs, menu, tracker) {
    const auth = new GoogleAuth({clientId: PageConfig.getOption('googleDriveClientId'),
      apiKey: PageConfig.getOption('googleDriveApiKey'), appId: PageConfig.getOption('googleDriveAppId')});
    const drive = new DriveAPI(() => auth.token(),undefined,token=>auth.invalidate(token));
    let links = new WeakMap(); let dataLinks=new WeakMap(); let busy = false; let prepared = false; let preparationError = '';
    let sidebar; let authorizedFiles = []; let listLoaded = false; let folders=[]; const commandIds=[];
    const refreshSidebar = () => { sidebar?.refresh(); for(const id of commandIds) app.commands.notifyCommandChanged(id); };
    const clearList = () => { authorizedFiles=[]; listLoaded=false; folders=[]; };
    const ensureFolder = async () => {
      if(!folders.length) folders=[await drive.workspaceRoot()];
      return folders.at(-1);
    };
    const loadFolder = async () => {
      const folder=await ensureFolder();
      authorizedFiles=await drive.listFolder(folder.id);
      native.setFolderFiles(authorizedFiles);
      listLoaded=true;
    };
    const tell = (title, body) => showDialog({title, body, buttons: [Dialog.okButton()]});
    const contents = app.serviceManager.contents;
    const native = new NativeDrive(drive);
    contents.addDrive(native);
    const nativePanels = new Set();
    const saveFailures = new WeakMap();
    // Best-effort browser warning, not a backup.
    globalThis.addEventListener('beforeunload',event=>{
      if(needsLeaveWarning({
        dirtyNative:[...nativePanels].some(p=>!p.isDisposed&&p.context.model.dirty),
        pendingSave:native.hasPendingSave,temporaryOutputs:native.hasOutputs
      })) {
        event.preventDefault();
        event.returnValue='';
      }
    });
    const requireClosed = () => {
      if (nativePanels.size || native.hasPendingSave) throw new Error('Close all experimental Google Drive notebooks before switching accounts or disconnecting. To keep them open, use Renew authorization. Export unsaved work first.');
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
    const activeNotebook=()=>{const panel=tracker.currentWidget;return panel&&!panel.isDisposed&&app.shell.currentWidget===panel?panel:null;};
    const activeData=()=>{
      const widget=app.shell.currentWidget;
      if(!widget || activeNotebook()) return null;
      const context=docs.contextForWidget(widget);
      if(!context || context.isDisposed || contents.driveName(context.path) ||
        !isTextDatafile(context.path) || typeof context.model?.toString!=='function') return null;
      return context;
    };
    const run = fn => async (args) => {
      if (busy) return;
      busy = true; refreshSidebar();
      try { await fn(args); } catch (e) { await tell('Google Drive', String(e.message || e)); }
      finally { busy = false; refreshSidebar(); }
    };
    const add = (name, label, fn) => {
      const id = 'jupyterlite-google-drive:' + name;
      commandIds.push(id);
      const enabled=()=>!busy && (name==='connect'?prepared:
        name==='renew'?prepared&&auth.hasAccount:
        name==='disconnect'?auth.hasAccount:
        name==='save-current-notebook'?auth.status==='connected'&&!!activeNotebook():
        name==='save-current-datafile'?auth.status==='connected'&&!!activeData():
        ['recover','download-notebook','download-output','notebook-status'].includes(name)?true:auth.status==='connected');
      app.commands.addCommand(id, {label:args=>args.inDriveMenu?label.replace(/^Google Drive: /,''):label, isEnabled:enabled, execute:args=>enabled()?run(fn)(args):undefined});
      return {command: id};
    };
    const connect = add('connect', 'Google Drive: Connect', async () => {
      if (!prepared) throw new Error(preparationError || 'Google libraries are loading. Retry shortly.');
      requireClosed();
      if (!(await confirmOutputDiscard())) return;
      await auth.connect(); links = new WeakMap(); dataLinks=new WeakMap(); native.reset(); clearList();
      // Initialize the remote root even if the user opens a native notebook
      // via Picker rather than visiting the folder browser first.
      try { await loadFolder(); }
      catch(e) {
        await tell('Google Drive','Connected. Could not load JupyterLite: '+String(e.message||e)+'. Retry with Open folder.');
        return;
      }
      await tell('Google Drive', 'Connected. Choose Open folder to browse JupyterLite.');
    });
    const renew = add('renew','Google Drive: Renew authorization',async()=>{
      if (!prepared) throw new Error(preparationError || 'Google libraries are loading. Retry shortly.');
      await auth.renew();
      await tell('Google Drive','Authorization renewed. Open notebooks, mounted data and temporary outputs were preserved. Retry any failed save.');
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
    const nativeOpen = add('native-open', 'Google Drive: Open native notebook (experimental)', async (args={}) => {
      if(!args.fileId) {
      const answer = await showDialog({
        title: 'Experimental remote editor',
        body: 'This notebook opens directly on Google Drive. Standard save and JupyterLab autosave may write remotely. Checkpoints are available only in the current editor session; rename and delete are not implemented. You can make a local recovery copy without Google access. Use a disposable notebook only. Close it before switching accounts.',
        buttons: [Dialog.cancelButton(), Dialog.okButton({label:'Continue'})]
      });
      if (!answer.button.accept) return;
      }
      // A sidebar row may open a file from the current authorized listing.
      const id = args.fileId ? authorizedFiles.find(f=>f.id===args.fileId)?.id : await auth.pick();
      if (args.fileId && !id) throw new Error('Refresh the authorized notebook list first.');
      if (!id) return;
      if(!listLoaded) await loadFolder();
      const meta = await drive.metadata(id);
      if (meta.trashed || !/\.ipynb$/i.test(meta.name)) throw new Error('Select a non-trashed .ipynb file.');
      const path = native.mount(id, meta.name);
      const panel = docs.openOrReveal(native.name + ':' + path, 'Notebook');
      if (!panel) { native.release(path); throw new Error('Could not open native notebook.'); }
      if (!nativePanels.has(panel)) {
        nativePanels.add(panel);
        // JupyterLab clears dirty on successful save, even if the editor
        // changed after the snapshot was taken. Compare to the uploaded bytes.
        const guardDirty = (_sender, state) => {
          if (state === 'completed' && !panel.isDisposed) {
            saveFailures.delete(panel);
            if (native.hasUnsavedChanges(path, panel.context.model.toJSON())) {
              panel.context.model.dirty = true;
            }
          } else if (state === 'failed' && !panel.isDisposed) {
            saveFailures.set(panel,true);
            panel.context.model.dirty = true;
          }
          refreshSidebar();
        };
        panel.context.saveState.connect(guardDirty);
        panel.disposed.connect(() => {
          panel.context.saveState.disconnect(guardDirty);
          nativePanels.delete(panel);
          native.release(path);
        });
      }
      await panel.context.ready;
      if(!args.fileId) await tell('Google Drive', 'Opened native notebook. Standard Save writes to Google Drive. For recovery, use Google Drive: Save local recovery copy.');
    });
    const save = add('save', 'Google Drive: Save to original', async () => {
      const panel = current();
      if (panel.context.path.startsWith(native.name+':')) throw new Error('This notebook is already remote. Use standard Save (Ctrl+S) to update its original.');
      const link = links.get(panel);
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
      const nativePath=panel.context.path.startsWith(native.name+':');
      const info=nativePath?native.saveInfo(contents.localPath(panel.context.path)):null;
      const name = notebookName(info?.name || panel.context.path.split('/').pop());
      const folder=await ensureFolder();
      const meta = await drive.create(name, panel.context.model.toJSON(),folder.id);
      if (!nativePath) links.set(panel, {id: meta.id, name: meta.name, version: meta.version});
      try { await loadFolder(); } catch { authorizedFiles=[]; listLoaded=false; }
      await tell('Google Drive', `Created ${meta.name} in JupyterLite (${folder.name}).`+(nativePath?' Standard Save still targets the originally opened notebook.':''));
    });
    const saveCurrentNotebook=add('save-current-notebook','Google Drive: Save current notebook',async()=>{
      const panel=current(); await panel.context.ready;
      if(panel.context.path.startsWith(native.name+':')) {
        await panel.context.save();
        return;
      }
      const link=links.get(panel);
      if(link) {
        const answer=await showDialog({title:'Update Google Drive?',body:'Overwrite '+link.name+' with the current notebook?',buttons:[Dialog.cancelButton(),Dialog.okButton()]});
        if(!answer.button.accept) return;
        const meta=await drive.update(link.id,link.version,panel.context.model.toJSON());
        links.set(panel,{id:meta.id,name:meta.name,version:meta.version});
        await tell('Google Drive','Saved '+meta.name+'.');
      } else {
        const folder=await ensureFolder();
        const meta=await drive.create(notebookName(panel.context.path.split('/').pop()),panel.context.model.toJSON(),folder.id);
        links.set(panel,{id:meta.id,name:meta.name,version:meta.version});
        try {await loadFolder();} catch {authorizedFiles=[];listLoaded=false;}
        await tell('Google Drive','Created '+meta.name+' in '+folder.name+'.');
      }
    });
    add('open-datafile','Google Drive: Open datafile',async(args={})=>{
      const file=authorizedFiles.find(f=>f.id===args.fileId&&isTextDatafile(f.name)&&!f.mimeType?.startsWith('application/vnd.google-apps.'));
      if(!file) throw new Error('Refresh the folder and select a supported text datafile.');
      const {meta,bytes}=await drive.readData(file.id);
      const text=decodeTextData(bytes);
      // Preserve the basename in the local root; never overwrite a local file.
      if(!meta.name || /[\\/:\x00-\x1f]/.test(meta.name) || ['.','..'].includes(meta.name))
        throw new Error('This filename cannot be represented safely in local storage.');
      const root=await contents.get('',{content:true});
      const occupied=new Set((root.content||[]).map(entry=>entry.name));
      const dot=meta.name.lastIndexOf('.');
      const stem=dot>0?meta.name.slice(0,dot):meta.name;
      const ext=dot>0?meta.name.slice(dot):'';
      let path=meta.name;
      for(let i=1;occupied.has(path);i++) path=stem+' ('+i+')'+ext;
      await contents.save(path,{type:'file',format:'text',content:text});
      const widget=docs.openOrReveal(path,'Editor');
      if(!widget) throw new Error('Local datafile copy created but the text editor could not open it.');
      const context=docs.contextForWidget(widget);
      if(!context) throw new Error('Datafile editor context unavailable.');
      await context.ready;
      dataLinks.set(context,{id:meta.id,name:meta.name,version:meta.version});
      if(path!==meta.name) await tell('Google Drive','A local file named '+meta.name+' already exists. Opened '+path+' instead; the remote link still targets '+meta.name+'.');
    });
    const saveCurrentData=add('save-current-datafile','Google Drive: Save current datafile',async()=>{
      const context=activeData();
      if(!context) throw new Error('Select an open text datafile first.');
      await context.ready;
      const bytes=new TextEncoder().encode(context.model.toString());
      const link=dataLinks.get(context);
      if(link) {
        const answer=await showDialog({title:'Update Google Drive?',body:'Overwrite '+link.name+' with the current datafile?',buttons:[Dialog.cancelButton(),Dialog.okButton()]});
        if(!answer.button.accept) return;
        const meta=await drive.updateData(link.id,link.version,bytes);
        dataLinks.set(context,{id:meta.id,name:meta.name,version:meta.version});
        await tell('Google Drive','Saved '+meta.name+'.');
      } else {
        const folder=await ensureFolder();
        const meta=await drive.createData(context.path.split('/').pop(),bytes,folder.id);
        dataLinks.set(context,{id:meta.id,name:meta.name,version:meta.version});
        try {await loadFolder();} catch {authorizedFiles=[];listLoaded=false;}
        await tell('Google Drive','Created '+meta.name+' in '+folder.name+'.');
      }
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
      await tell('Google Drive', `Mounted /drive/${path}. In a native notebook with filesystem synchronization enabled, use open("/drive/${path}", "rb"). Mounts expire on account switch, disconnect or refresh; same-account renewal preserves them.`);
    });
    const dependencyPanel=async()=>{
      const panel=current(); await panel.context.ready;
      if(panel.isDisposed||!panel.context.path.startsWith(native.name+':'))throw new Error('Open a native Google Drive notebook first.');
      return panel;
    };
    const rememberData=add('remember-data','Google Drive: Remember mounted data in notebook',async()=>{
      const panel=await dependencyPanel();
      if(native.saveInfo(contents.localPath(panel.context.path))?.writable===false)throw new Error('Notebook is read-only.');
      const model=panel.context.model;
      const previous=model.getMetadata(dependencyKey);
      const next=native.dependencyManifest();
      const names=next.dependencies.map(d=>'/drive/'+d.path).join(', ')||'(none)';
      const answer=await showDialog({title:'Remember mounted data?',
        body:'Replace this notebook’s dependency list with the current session’s mounted data: '+names+'. File IDs and aliases will be stored in notebook metadata and visible to anyone who can read the notebook. No credentials or file contents are stored. Save the notebook to persist the list.',
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Remember'})]});
      if(!answer.button.accept)return;
      if(panel.isDisposed||JSON.stringify(model.getMetadata(dependencyKey))!==JSON.stringify(previous))throw new Error('Notebook dependencies changed; retry.');
      model.setMetadata(dependencyKey,next);
      model.dirty=true;
      await tell('Google Drive','Dependencies recorded in notebook metadata. Save the notebook to persist them.');
    });
    const dependencyEditor=async()=>{
      const panel=await dependencyPanel();
      if(native.saveInfo(contents.localPath(panel.context.path))?.writable!==true)throw new Error('Notebook is not writable.');
      const model=panel.context.model;
      const previous=model.getMetadata(dependencyKey);
      const baseline=JSON.stringify(previous);
      const existing=validateDependencies(previous);
      const commit=next=>{
        if(panel.isDisposed||JSON.stringify(model.getMetadata(dependencyKey))!==baseline||
            native.saveInfo(contents.localPath(panel.context.path))?.writable!==true)
          throw new Error('Notebook or dependencies changed; retry.');
        model.setMetadata(dependencyKey,next);
        model.dirty=true;
      };
      return {previous,existing,commit};
    };
    const addDataDependency=add('add-dependency','Google Drive: Add selected data dependency',async()=>{
      const {previous,existing,commit}=await dependencyEditor();
      const mounted=native.listDataReferences();
      const candidates=mounted.filter(d=>!existing.some(e=>e.path===d.path));
      if(!candidates.length)throw new Error('No new mounted data aliases. Mount a file first, or remove a conflicting recorded dependency.');
      const result=await InputDialog.getItem({
        title:'Add data dependency?',
        label:'Choose one mounted file. Its Drive ID and alias will be stored in this notebook and visible to its readers. Existing dependencies remain unchanged.',
        items:candidates.map(d=>'/drive/'+d.path),editable:false,okLabel:'Add'
      });
      if(!result.button.accept)return;
      const chosen=candidates.find(d=>'/drive/'+d.path===result.value);
      if(!chosen||!native.listDataReferences().some(d=>d.path===chosen.path&&d.file_id===chosen.file_id))
        throw new Error('Mounted file changed; retry.');
      commit(addDependency(previous,chosen));
      await tell('Google Drive','Dependency added. Save the notebook to persist it.');
    });
    const removeDataDependency=add('remove-dependency','Google Drive: Remove recorded data dependency',async()=>{
      const {previous,existing,commit}=await dependencyEditor();
      if(!existing.length)throw new Error('This notebook has no recorded data dependencies.');
      const result=await InputDialog.getItem({
        title:'Remove recorded dependency?',
        label:'Remove one reference from this notebook only. The mounted data and the original Google Drive file are not deleted.',
        items:existing.map(d=>'/drive/'+d.path),editable:false,okLabel:'Remove'
      });
      if(!result.button.accept)return;
      const chosen=existing.find(d=>'/drive/'+d.path===result.value);
      if(!chosen)throw new Error('Choose a recorded dependency.');
      commit(removeDependency(previous,chosen.path));
      await tell('Google Drive','Dependency removed from notebook metadata. Save the notebook to persist it.');
    });
    const restoreData=add('restore-data','Google Drive: Restore notebook data dependencies',async()=>{
      const panel=await dependencyPanel();
      const model=panel.context.model;
      const value=model.getMetadata(dependencyKey);
      const deps=validateDependencies(value);
      if(!deps.length)throw new Error('This notebook has no recorded Google Drive dependencies.');
      const answer=await showDialog({title:'Restore notebook data dependencies?',
        body:'Mount these declared data paths: '+deps.map(d=>'/drive/'+d.path).join(', ')+'. Google Drive checks access for each file. No extra permissions are requested; if a file is inaccessible, select it separately with Google Picker and retry. Existing aliases will not be overwritten.',
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Restore'})]});
      if(!answer.button.accept)return;
      if(panel.isDisposed||JSON.stringify(model.getMetadata(dependencyKey))!==JSON.stringify(value))throw new Error('Notebook dependencies changed; retry.');
      const paths=await native.restoreDependencies(value);
      await tell('Google Drive','Restored notebook data dependencies: '+paths.map(p=>'/drive/'+p).join(', '));
    });
    const downloadNotebook=add('download-notebook','Google Drive: Download notebook recovery file',async()=>{
      const panel=current(); await panel.context.ready;
      if(panel.isDisposed)throw new Error('Notebook closed.');
      const info=panel.context.path.startsWith(native.name+':')?native.saveInfo(contents.localPath(panel.context.path)):null;
      const name=notebookName(info?.name||panel.context.path.split('/').pop());
      downloadBytes(name,notebookBackupBytes(panel.context.model.toJSON()),'application/x-ipynb+json');
    });
    const downloadOutput=add('download-output','Google Drive: Download Python output locally',async()=>{
      const paths=native.listOutputs();
      if(!paths.length)throw new Error('No temporary output files to download.');
      const result=await InputDialog.getItem({title:'Download Python output?',label:'Choose a temporary file to download to your computer. No Google connection is required.',items:paths,editable:false,okLabel:'Download'});
      if(!result.button.accept)return;
      const {name,bytes}=native.outputSnapshot(result.value);
      downloadBytes(name,bytes);
    });
    const exportData = add('export-data', 'Google Drive: Export Python output as new file', async () => {
      const paths = native.listOutputs();
      if (!paths.length) throw new Error('No output files. In a native notebook with filesystem synchronization, write a file under /drive/output/ first.');
      const result = await InputDialog.getItem({title:'Choose Python output',label:'Temporary files shared by native notebooks in this browser session',items:paths,editable:false,okLabel:'Select'});
      if (!result.button.accept) return;
      const {name,bytes} = native.outputSnapshot(result.value);
      const answer = await showDialog({title:'Create new file on Google Drive?',
        body:`Upload ${name} (${bytes.length} bytes) to the current JupyterLite folder? This creates a new file and never overwrites an existing Drive file. The temporary source remains available.`,
        buttons:[Dialog.cancelButton(),Dialog.okButton({label:'Upload'})]});
      if (!answer.button.accept) return;
      const folder=await ensureFolder();
      const meta = await drive.createData(name,bytes,folder.id);
      try { await loadFolder(); } catch { authorizedFiles=[]; listLoaded=false; }
      await tell('Google Drive',`Created ${meta.name} in JupyterLite (${folder.name}).`);
    });
    const disconnect = add('disconnect', 'Google Drive: Disconnect', async () => {
      requireClosed();
      if (!(await confirmOutputDiscard())) return;
      auth.disconnect(); links = new WeakMap(); dataLinks=new WeakMap(); native.reset(); clearList();
      await tell('Google Drive', 'Disconnected. Local notebook copies remain in this browser.');
    });
    const refreshList=add('refresh-list','Google Drive: Refresh workspace list',async()=>{
      await loadFolder();
    });
    const openFolder=add('open-folder','Google Drive: Open folder',async(args={})=>{
      if(args.up && folders.length>1) folders.pop();
      else if(args.folderId) {
        const child=authorizedFiles.find(f=>f.id===args.folderId && f.mimeType===folderMime);
        if(!child) throw new Error('Refresh the folder first.');
        folders.push(child);
      }
      authorizedFiles=[];listLoaded=false;
      native.setFolderFiles([]);
      sidebar.setViewMode('files');
      app.shell.activateById(sidebar.id);
      await loadFolder();
    });
    const notebookStatus=add('notebook-status','Google Drive: Notebook and data status',async()=>{
      sidebar.setViewMode('status');
      app.shell.activateById(sidebar.id);
    });
    const newFolder=add('new-folder','Google Drive: New folder',async()=>{
      const result=await InputDialog.getText({title:'New folder',label:'Folder name',okLabel:'Create'});
      const name=result.value?.trim();
      if(!result.button.accept || !name) return;
      if(name.includes('/') || name==='.' || name==='..') throw new Error('Invalid folder name.');
      const folder=await ensureFolder();
      await drive.createFolder(name,folder.id);
      await loadFolder();
    });
    sidebar=new DriveSidebar(app.commands,()=>{
      const panel=tracker.currentWidget;
      const hasNotebook=!!panel && !panel.isDisposed && app.shell.currentWidget===panel;
      const isNative=hasNotebook && panel.context.path.startsWith(native.name+':');
      const info=isNative?native.saveInfo(contents.localPath(panel.context.path)):null;
      const saveStatus=hasNotebook?describeSave({isNative,linked:links.has(panel),dirty:panel.context.model.dirty,info,failed:saveFailures.has(panel),auth:auth.status}):null;
      let dependencies=[],dependencyError='';
      if(isNative)try{const mounted=native.listDataReferences();dependencies=validateDependencies(panel.context.model.getMetadata(dependencyKey)).map(d=>({path:d.path,status:dependencyStatus(d,mounted)}));}catch(e){dependencyError=String(e.message||e);}
      return {prepared,preparationError,busy,auth:auth.status,hasAccount:auth.hasAccount,hasNotebook,isNative,saveStatus,dependencies,dependencyError,dependencyEditable:info?.writable===true,
        notebookName:hasNotebook?(info?.name || panel.context.path.split('/').pop()):'',
        current:!hasNotebook?'No active notebook':isNative?'Remote notebook — standard Save and autosave write to Drive':
          links.has(panel)?'Local copy — explicit Save to original writes to Drive':'Local notebook — browser storage',
        files:auth.status==='connected'?authorizedFiles.map(f=>({id:f.id,name:f.name,readOnly:f.capabilities?.canEdit===false,
          mimeType:f.mimeType, modified:f.modifiedTime?new Date(f.modifiedTime).toLocaleString():''})):[],
        folderPath:folders.map(f=>f.name).join(' / '),canGoUp:folders.length>1,loaded:listLoaded,data:native.listData(),outputs:native.listOutputs()};
    });
    app.shell.add(sidebar,'left',{rank:700});
    tracker.currentChanged.connect(refreshSidebar);
    app.shell.currentChanged?.connect(refreshSidebar);
    native.fileChanged.connect(refreshSidebar);

    // Two compact File entries. Keep the ordinary native workflow separate
    // from account switching, legacy local-copy and recovery operations.
    const buildMenu=(id,title,groups)=>{
      const submenu=new Menu({commands:app.commands});
      submenu.id=id;
      submenu.title.label=title;
      groups.forEach((group,i)=>{
        if(i)submenu.addItem({type:'separator'});
        group.forEach(item=>submenu.addItem({...item,args:{inDriveMenu:true}}));
      });
      return submenu;
    };
    const driveMenu=buildMenu('jupyterlite-google-drive-menu','Google Drive',[
      [connect,openFolder],
      [saveCurrentNotebook,saveCurrentData],
      [disconnect]
    ]);
    const advancedMenu=buildMenu('jupyterlite-google-drive-advanced-menu','Google Drive (advanced)',[
      [renew,nativeOpen,open,browse,save,saveAs],
      [refreshList,newFolder],
      [mountData,importData,exportData,addDataDependency,removeDataDependency,rememberData,restoreData],
      [notebookStatus,recover,downloadNotebook,downloadOutput]
    ]);
    menu.fileMenu.addGroup([
      {type:'submenu',submenu:driveMenu},
      {type:'submenu',submenu:advancedMenu}
    ],80);
    // Load external scripts only if configured; connect itself remains a user gesture.
    void auth.prepare().then(() => {prepared = true;refreshSidebar();}).catch(e => {preparationError = String(e.message || e);refreshSidebar();});
  }
};
export default [plugin,editingTools,variableInspector];
