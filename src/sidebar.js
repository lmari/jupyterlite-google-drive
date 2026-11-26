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
    this.timer=globalThis.setInterval(()=>this.refresh(),1000);
    this.refresh();
  }
  dispose() {
    if (this.isDisposed) return;
    globalThis.clearInterval(this.timer);
    super.dispose();
  }
  refresh() {
    if (this.isDisposed) return;
    const s=this.state();
    const key=JSON.stringify(s);
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
    if(s.hasAccount) body.append(button('Renew authorization','renew',s.prepared));
    body.append(button(s.hasAccount?'Switch Google account':'Connect to Google Drive','connect',s.prepared));
    body.append(button('Disconnect from Google Drive','disconnect',s.auth!=='disconnected'));
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
    body.append(button('Save local recovery copy','recover',s.hasNotebook));
    section('Authorized notebooks','Only files already authorized for this app. Select additional files with Google Picker.');
    body.append(button('Refresh notebook list','refresh-list',connected));
    body.append(button('Choose notebook from Drive…','native-open',connected));
    if(connected) {
      if(!s.files.length)body.append(element('div',s.loaded?'No authorized notebooks.':'Refresh to load the list.'));
      for(const file of s.files) {
        const item=element('div');
        Object.assign(item.style,{borderTop:'1px solid var(--jp-border-color2)',paddingTop:'5px',overflowWrap:'anywhere'});
        item.append(element('div',file.name+(file.readOnly?' (read-only)':'')));
        const line=element('div',file.modified||'');
        line.style.fontSize='var(--jp-ui-font-size0)';item.append(line);
        item.append(button('Open '+file.name,'native-open',true,{fileId:file.id}));
        body.append(item);
      }
    }
    section('Mounted data','Read-only files under /drive/data/ in native notebooks.');
    body.append(button('Mount data file…','mount-data',connected&&s.isNative));
    body.append(button('Import temporary data copy…','import-data',connected&&s.hasNotebook));
    if(!s.data.length)body.append(element('div','No mounted data.'));
    for(const path of s.data)body.append(element('code','/drive/'+path));
    if(s.isNative) {
      section('Notebook dependencies','Saved in notebook metadata. Restore explicitly after opening on another device.');
      if(s.dependencyError)body.append(element('div',s.dependencyError));
      else if(!s.dependencies.length)body.append(element('div','No recorded dependencies.'));
      for(const path of s.dependencies)body.append(element('div','Recorded: /drive/'+path));
      body.append(button('Remember mounted data','remember-data',connected));
      body.append(button('Restore notebook data dependencies','restore-data',connected&&!s.dependencyError&&s.dependencies.length>0));
    }
    section('Python output','Temporary files under /drive/output/. Export before switching accounts or reloading.');
    if(!s.outputs.length)body.append(element('div','No output files.'));
    for(const path of s.outputs)body.append(element('code','/drive/'+path));
    body.append(button('Export output to Drive…','export-data',connected&&s.outputs.length>0));
    if(s.busy)body.append(element('div','Operation in progress…'));
    this.node.replaceChildren(body);
  }
}
