import {INotebookTracker} from '@jupyterlab/notebook';
import {showDialog,Dialog} from '@jupyterlab/apputils';
import {Widget} from '@lumino/widgets';
import {tableIcon} from '@jupyterlab/ui-components';
import {inspectVariables} from './variable-snapshot.js';

export const variablesCommand='jupyterlite-touch-tools:show-variables';
const el=(tag,text)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  return node;
};

class VariablesPanel extends Widget {
  constructor(tracker,{notebook=null,modal=false}={}){
    super({node:el('section')});
    this.id=modal?'jupyterlite-python-variables-dialog':'jupyterlite-python-variables';
    this.title.label='Variables';this.title.caption='Python variables';this.title.icon=tableIcon;
    this.node.setAttribute('aria-label','Python variables');
    Object.assign(this.node.style,{padding:'12px',overflow:'auto',fontSize:'var(--jp-ui-font-size1)',color:'var(--jp-ui-font-color1)',background:'var(--jp-layout-color1)'});
    this.heading=el('h2','Python variables');
    if(modal){
      this.heading.hidden=true;
      Object.assign(this.node.style,{boxSizing:'border-box',width:'min(76vw, 560px)',maxHeight:'52vh',padding:'8px 0'});
    }
    this.name=el('div','No active notebook');
    this.refreshButton=el('button','Refresh variables');
    this.refreshButton.type='button';this.refreshButton.className='jp-mod-styled';
    Object.assign(this.refreshButton.style,{minHeight:'36px',margin:'8px 0',padding:'4px 10px'});
    this.status=el('div','Select a notebook and run a cell.');
    this.status.setAttribute('role','status');
    this.results=el('div');
    this.node.append(this.heading,this.name,this.refreshButton,this.status,this.results);
    this.panel=null;this.kernel=null;this.generation=0;this.pending=false;this.snapshot=null;
    this.refreshButton.addEventListener('click',()=>void this.refresh());
    if(tracker)tracker.currentChanged.connect((_,p)=>this.bind(p),this);
    this.bind(notebook??tracker?.currentWidget??null);
    this.updateButton();
  }
  dispose(){
    if(this.isDisposed)return;
    // Invalidate a pending reply and detach the notebook listeners before
    // disposal. Modal instances are short-lived and must not retain kernels.
    this.bind(null);
    super.dispose();
  }
  bind(panel){
    if(panel===this.panel)return;
    if(this.panel){
      this.panel.sessionContext.kernelChanged.disconnect(this.onKernelChanged,this);
      this.panel.sessionContext.statusChanged.disconnect(this.onStatus,this);
      this.panel.disposed.disconnect(this.onDisposed,this);
    }
    this.panel=panel;
    if(panel){
      panel.sessionContext.kernelChanged.connect(this.onKernelChanged,this);
      panel.sessionContext.statusChanged.connect(this.onStatus,this);
      panel.disposed.connect(this.onDisposed,this);
    }
    this.onKernelChanged();
  }
  onDisposed(){this.bind(null);}
  onKernelChanged(){
    this.generation++;
    this.pending=false;
    this.snapshot=null;
    this.kernel=this.panel?.sessionContext.session?.kernel??null;
    this.results.replaceChildren();
    this.name.textContent=this.panel?.title.label||'No active notebook';
    this.status.textContent=!this.panel?'No active notebook.':!this.kernel?'Start the Python kernel, run a cell, then refresh.':this.kernel.name!=='python'?'Only the Pyodide Python kernel is supported.':'Run a cell, then refresh to inspect variables.';
    this.updateButton();
  }
  onStatus(){
    const state=this.kernel?.status;
    if(['restarting','autorestarting','dead','terminating'].includes(state)){
      this.generation++;this.pending=false;this.snapshot=null;
      this.results.replaceChildren();this.status.textContent='Kernel changed; refresh after running code.';
    }else if(state==='busy'&&!this.pending&&this.snapshot){
      this.status.textContent='Snapshot may be outdated. Refresh after execution.';
    }
    this.updateButton();
  }
  updateButton(){
    this.refreshButton.disabled=this.pending||!this.kernel||this.kernel.isDisposed||
      this.kernel.name!=='python'||this.kernel.status!=='idle';
  }
  async refresh(){
    if(this.refreshButton.disabled)return;
    const kernel=this.kernel, generation=++this.generation;
    this.pending=true;this.updateButton();this.status.textContent='Inspecting Python variables…';
    try{
      const data=await inspectVariables(kernel);
      if(this.isDisposed||generation!==this.generation||kernel!==this.kernel)return;
      this.snapshot=data;this.renderRows(data);
      this.status.textContent='Snapshot: '+data.rows.length+' of '+data.total+' variables. Refresh after running code.';
    }catch(error){
      if(!this.isDisposed&&generation===this.generation)
        this.status.textContent='Refresh failed: '+String(error?.message||error);
    }finally{
      if(!this.isDisposed&&generation===this.generation){this.pending=false;this.updateButton();}
    }
  }
  renderRows(data){
    const table=el('table');table.setAttribute('aria-label','Variable snapshot');
    Object.assign(table.style,{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',marginTop:'8px'});
    const head=el('thead'),row=el('tr');
    for(const text of ['Name','Type','Value']){const th=el('th',text);th.scope='col';th.style.textAlign='left';row.append(th);}
    head.append(row);table.append(head);
    const body=el('tbody');
    for(const item of data.rows){
      const tr=el('tr');
      for(const field of ['name','type','value']){
        const td=el('td',item[field]);
        Object.assign(td.style,{padding:'6px 3px',borderTop:'1px solid var(--jp-border-color2)',overflowWrap:'anywhere',whiteSpace:'pre-wrap',verticalAlign:'top'});
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    this.results.replaceChildren(data.rows.length?table:el('p','No user variables.'));
  }
}

export default {
  id:'jupyterlite-touch-tools:variables',
  autoStart:true,
  requires:[INotebookTracker],
  activate(app,tracker){
    const sidebar=new VariablesPanel(tracker);
    app.shell.add(sidebar,'right',{rank:700});
    let dialogOpen=false;
    app.commands.addCommand(variablesCommand,{
      label:'Show Python variables',
      execute:async args=>{
        if(dialogOpen)return;
        // The toolbar belongs to a particular notebook, not whichever
        // main-area widget happens to hold focus after the touch.
        let notebook=null;
        if(typeof args.widgetId==='string'){
          tracker.forEach(panel=>{if(panel.id===args.widgetId)notebook=panel;});
        }else notebook=tracker.currentWidget;
        if(!notebook||notebook.isDisposed)return;
        dialogOpen=true;
        const view=new VariablesPanel(null,{notebook,modal:true});
        try{
          // Always show visible feedback, independently of LabShell's
          // collapsed/hidden sidebars and simple-document layout.
          const closed=showDialog({title:'Python variables',body:view,
            buttons:[Dialog.okButton({label:'Close'})]});
          // Opening Variables is an explicit inspection request. If idle,
          // populate once; further refreshes are always user initiated.
          if(!view.refreshButton.disabled)void view.refresh();
          await closed;
        }finally{
          if(!view.isDisposed)view.dispose();
          dialogOpen=false;
        }
      }
    });
  }
};
