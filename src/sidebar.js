import {isTextDatafile} from './drive-api.js';
import {Widget} from '@lumino/widgets';
import {folderIcon} from '@jupyterlab/ui-components';

const element = (tag,text) => {
  const node=document.createElement(tag);
  if (text !== undefined) node.textContent=text;
  return node;
};

// The sidebar is only a view of the existing command registry and adapter.
// It never stores credentials or creates a second remote-save implementation.
export class DriveSidebar extends Widget {
  constructor(commands, state) {
    super({node:element('section')});
    this.id='jupyterlite-google-drive-sidebar';
    this.title.label='Drive';
    this.title.caption='Google Drive';
    this.title.icon=folderIcon;
    this.node.setAttribute('aria-label','Google Drive workspace');
    this.node.classList.add('jp-GoogleDriveSidebar');
    Object.assign(this.node.style,{overflow:'auto',padding:'12px',color:'var(--jp-ui-font-color1)',
      background:'var(--jp-layout-color1)',fontSize:'var(--jp-ui-font-size1)',boxSizing:'border-box'});
    this.commands=commands;this.state=state;
    this.lastState='';
    this.advancedOpen=false;
    this.mode='files';
    this.timer=globalThis.setInterval(()=>this.refresh(),1000);
    this.refresh();
  }
  dispose() {
    if (this.isDisposed) return;
    globalThis.clearInterval(this.timer);
    super.dispose();
  }
  // Do not override Lumino Widget.show(), which controls actual visibility.
  setViewMode(mode) {
    this.mode=mode;
    this.refresh();
  }
  refresh() {
    if (this.isDisposed) return;
    const s=this.state();
    const key=JSON.stringify([this.mode,s]);
    if (key===this.lastState) return;
    this.lastState=key;
    const body=element('div');
    Object.assign(body.style,{display:'flex',flexDirection:'column',gap:'8px'});
    const heading=element('h2','Google Drive');
    heading.style.margin='0';
    body.append(heading);
    const status=element('div',s.preparationError?'Configuration unavailable':
      !s.prepared?'Loading Google services…':s.auth==='connected'?'Authorized':
      s.auth==='expired'?'Authorization expired':'Not connected');
    status.setAttribute('role','status');
    status.dataset.driveStatus=s.auth;
    status.style.fontWeight='600';
    body.append(status);
    if(s.preparationError) body.append(element('p',s.preparationError));
    const button=(label,command,enabled=true,args={})=>{
      const b=element('button',label);
      b.type='button';
      b.className='jp-mod-styled';
      Object.assign(b.style,{padding:'5px 8px',textAlign:'left',whiteSpace:'normal',width:'100%'});
      b.disabled=s.busy||!enabled;
      b.addEventListener('click',()=>{void this.commands.execute('jupyterlite-google-drive:'+command,args);});
      return b;
    };
    const connected=s.auth==='connected';
    if(this.mode==='files') {
      if(!connected) body.append(button(s.hasAccount?'Renew authorization':'Connect',s.hasAccount?'renew':'connect',s.prepared));
      const path=element('h3',s.folderPath||'JupyterLite');
      path.style.margin='4px 0';
      body.append(path);
      const toolbar=element('div');
      Object.assign(toolbar.style,{display:'flex',gap:'4px',flexWrap:'wrap'});
      const tool=(label,command,enabled,args={})=>{
        const b=button(label,command,enabled,args);
        b.style.width='auto';
        toolbar.append(b);
      };
      tool('Up one folder','open-folder',connected&&s.canGoUp,{up:true});
      tool('Refresh folder','refresh-list',connected);
      tool('New folder','new-folder',connected);
      body.append(toolbar);
      if(!connected) {
        body.append(element('p','Connect to Google Drive to browse your JupyterLite folder.'));
      } else {
        const list=element('div');
        list.setAttribute('role','list');
        list.setAttribute('aria-label','Folder contents');
        Object.assign(list.style,{display:'flex',flexDirection:'column',gap:'2px'});
        const files=[...s.files].sort((a,b)=>
          Number(b.mimeType==='application/vnd.google-apps.folder')-Number(a.mimeType==='application/vnd.google-apps.folder') ||
          a.name.localeCompare(b.name));
        for(const file of files) {
          const folder=file.mimeType==='application/vnd.google-apps.folder';
          const notebook=/\.ipynb$/i.test(file.name)&&!file.mimeType?.startsWith('application/vnd.google-apps.');
          const item=element('div');
          item.setAttribute('role','listitem');
          const label=(folder?'📁 ':notebook?'📓 ':'📄 ')+file.name+(file.readOnly?' (read-only)':'');
          const datafile=isTextDatafile(file.name)&&!file.mimeType?.startsWith('application/vnd.google-apps.');
          if(folder||notebook||datafile) {
            const b=button(label,folder?'open-folder':notebook?'open-folder-notebook':'open-datafile',true,folder?{folderId:file.id}:{fileId:file.id});
            b.setAttribute('aria-label',(folder?'Open folder ':'Open ')+file.name);
            b.title=file.name;
            b.style.overflowWrap='anywhere';
            item.append(b);
          } else {
            const line=element('div',label);
            Object.assign(line.style,{padding:'5px 8px',overflowWrap:'anywhere'});
            item.append(line);
          }
          list.append(item);
        }
        body.append(list);
        if(!files.length) body.append(element('div',s.busy?'Loading folder…':s.loaded?'No authorized files in this folder.':'Refresh to load the folder.'));
        const note=element('div','Only files authorized for this app are visible.');
        note.style.color='var(--jp-ui-font-color2)';
        body.append(note);
        if(s.hasNotebook) {
          const hint=element('div','Python: /local/<filename> reads browser storage; /drive/<filename> reads Google Drive (requires filesystem synchronization).');
          hint.style.color='var(--jp-ui-font-color2)';
          body.append(hint);
        }
      }
      this.node.replaceChildren(body);
      return;
    }
    const advanced=element('details');
    advanced.open=this.advancedOpen;
    advanced.addEventListener('toggle',()=>{this.advancedOpen=advanced.open;});
    const summary=element('summary','Advanced actions');
    summary.style.cursor='pointer';advanced.append(summary);
    const advancedBody=element('div');Object.assign(advancedBody.style,{display:'flex',flexDirection:'column',gap:'8px',paddingTop:'8px'});advanced.append(advancedBody);
    if(s.hasAccount) body.append(button('Renew authorization','renew',s.prepared));
    if(s.hasAccount)advancedBody.append(button('Switch Google account','connect',s.prepared));
    else body.append(button('Connect to Google Drive','connect',s.prepared));
    advancedBody.append(button('Disconnect from Google Drive','disconnect',s.auth!=='disconnected'));
    const section=(title,desc)=>{
      const h=element('h3',title);h.style.margin='12px 0 0';
      body.append(h);const p=element('div',desc);p.style.color='var(--jp-ui-font-color2)';body.append(p);
    };
    section('Current notebook',s.current);
    if (s.saveStatus) {
      body.append(element('strong',s.notebookName));
      const indicator=element('div',s.saveStatus.text);
      indicator.dataset.saveState=s.saveStatus.kind;
      indicator.setAttribute('aria-live','polite');
      indicator.style.fontWeight='600';
      indicator.style.color=s.saveStatus.kind==='failed'?'var(--jp-error-color1)':
        ['dirty','unavailable'].includes(s.saveStatus.kind)?'var(--jp-warn-color1)':
        s.saveStatus.kind==='saved'?'var(--jp-success-color1)':'var(--jp-ui-font-color1)';
      body.append(indicator);
      if(s.saveStatus.at)body.append(element('div','Last acknowledged upload: '+new Date(s.saveStatus.at).toLocaleTimeString()));
    }
    body.append(button('Save notebook as new Drive copy','save-as',connected&&s.hasNotebook));
    advancedBody.append(button('Save local recovery copy','recover',s.hasNotebook));
    body.append(button('Download notebook recovery file','download-notebook',s.hasNotebook));
    section('Mounted data','Read-only files under /drive/data/ in native notebooks.');
    body.append(button('Mount data file…','mount-data',connected&&s.isNative));
    advancedBody.append(button('Import temporary data copy…','import-data',connected&&s.hasNotebook));
    if(!s.data.length)body.append(element('div','No mounted data.'));
    for(const path of s.data)body.append(element('code','/drive/'+path));
    if(s.isNative) {
      section('Notebook dependencies','Saved in notebook metadata. Restore explicitly after opening on another device.');
      if(s.dependencyError)body.append(element('div',s.dependencyError));
      else if(!s.dependencies.length)body.append(element('div','No recorded dependencies.'));
      for(const d of s.dependencies){
        body.append(element('div','Recorded: /drive/'+d.path));
        const status=element('div',d.status==='mounted'?'Mounted':d.status==='collision'?'Alias refers to another file':'Not mounted');
        status.style.color=d.status==='collision'?'var(--jp-error-color1)':'var(--jp-ui-font-color2)';
        status.dataset.dependencyState=d.status;
        body.append(status);
      }
      body.append(button('Add selected dependency…','add-dependency',connected&&s.dependencyEditable&&!s.dependencyError&&s.data.some(p=>!s.dependencies.some(d=>d.path===p))));
      body.append(button('Remove recorded dependency…','remove-dependency',s.dependencyEditable&&!s.dependencyError&&s.dependencies.length>0));
      advancedBody.append(button('Replace with all mounted data…','remember-data',connected&&s.dependencyEditable));
      body.append(button('Restore notebook data dependencies','restore-data',connected&&!s.dependencyError&&s.dependencies.length>0));
    }
    section('Python output','Temporary files under /drive/output/. Export before switching accounts or reloading.');
    if(!s.outputs.length)body.append(element('div','No output files.'));
    for(const path of s.outputs)body.append(element('code','/drive/'+path));
    body.append(button('Export output to Drive…','export-data',connected&&s.outputs.length>0));
    body.append(button('Download output locally…','download-output',s.outputs.length>0));
    body.append(advanced);
    if(s.busy)body.append(element('div','Operation in progress…'));
    this.node.replaceChildren(body);
  }
}
