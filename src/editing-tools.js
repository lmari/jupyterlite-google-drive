// Independent notebook editing plugin: no Drive authorization or storage dependency.
import {INotebookTracker} from '@jupyterlab/notebook';
import {showDialog,Dialog} from '@jupyterlab/apputils';
import {Text} from '@jupyterlab/coreutils';
import {Widget} from '@lumino/widgets';
import {indentMore, indentLess} from '@codemirror/commands';

const COMPLETE='completer:invoke-notebook';

function install(app,panel) {
  const notebook=panel.content;
  const bar=new Widget({node:document.createElement('div')});
  bar.addClass('jp-TouchEditingTools');
  bar.node.setAttribute('role','toolbar');
  bar.node.setAttribute('aria-label','Notebook editing tools');
  Object.assign(bar.node.style,{
    // Lumino measures minimum sizes, not the natural height of a flex row.
    // Reserve room explicitly so notebook content never overlays the controls.
    display:'flex',flexWrap:'nowrap',alignItems:'center',gap:'4px',
    boxSizing:'border-box',minHeight:'46px',minWidth:'0',overflowX:'auto',overflowY:'hidden',
    padding:'4px 8px',borderBottom:'1px solid var(--jp-border-color2)',
    background:'var(--jp-layout-color1)',color:'var(--jp-ui-font-color1)'
  });
  const title=document.createElement('span');
  title.textContent='Editing';
  Object.assign(title.style,{fontSize:'var(--jp-ui-font-size0)',marginRight:'4px'});
  bar.node.append(title);
  const buttons=new Map();
  const status=document.createElement('span');
  status.setAttribute('role','status');
  status.style.fontSize='var(--jp-ui-font-size0)';
  const canEdit=cell=>!!cell&&!notebook.viewOnly&&!panel.context.model.readOnly&&!cell.readOnly;
  const readyCell=async expected=>{
    if(panel.isDisposed||notebook.activeCell!==expected||!canEdit(expected))return null;
    await expected.ready;
    if(panel.isDisposed||notebook.activeCell!==expected||!canEdit(expected))return null;
    return expected;
  };
  const button=(name,caption,action)=>{
    const b=document.createElement('button');
    b.type='button'; b.textContent=name; b.title=caption;
    b.className='jp-mod-styled';
    Object.assign(b.style,{
      flex:'0 0 auto',minHeight:'36px',padding:'4px 9px',fontSize:'var(--jp-ui-font-size1)',
      touchAction:'manipulation',whiteSpace:'nowrap'
    });
    // Preserve the editor selection on desktop; touch and keyboard use
    // normal button activation, not simulated keyboard shortcuts.
    b.addEventListener('mousedown',e=>e.preventDefault());
    b.addEventListener('click',async()=>{
      if(b.disabled)return;
      status.textContent='';
      try { await action(notebook.activeCell); }
      catch(e){status.textContent=String(e?.message||e);}
      finally {if(!bar.isDisposed)refresh();}
    });
    buttons.set(name,b);bar.node.append(b);
  };
  const focusCode=async cell=>{
    cell=await readyCell(cell);
    if(!cell||cell.model.type!=='code')return null;
    app.shell.activateById(panel.id);
    notebook.mode='edit';
    cell.editor?.focus();
    return cell.editor;
  };
  button('Complete','Show code completion suggestions at the cursor',async cell=>{
    if(await focusCode(cell))await app.commands.execute(COMPLETE);
  });
  button('Help','Show Python documentation at the cursor',async cell=>{
    const editor=await focusCode(cell);
    if(!editor)return;
    const kernel=panel.sessionContext.session?.kernel;
    if(!kernel||kernel.isDisposed||kernel.status!=='idle'){
      throw new Error('Start the Python kernel and wait until it is idle.');
    }
    const source=cell.model.sharedModel.getSource();
    const offset=editor.getOffsetAt(editor.getCursorPosition());
    // Native kernel inspection, not an execute request. IPython may treat
    // a cursor immediately after a token as outside that token.
    const positions=[offset];
    if(offset>0&&/[\p{L}\p{N}_]/u.test(source[offset-1])&&
       !/[\p{L}\p{N}_]/u.test(source[offset]||''))positions.push(offset-1);
    let documentation='';
    for(const pos of positions){
      const reply=await kernel.requestInspect({
        code:source,cursor_pos:Text.jsIndexToCharIndex(pos,source),detail_level:1
      });
      if(panel.isDisposed||notebook.activeCell!==cell||
         panel.sessionContext.session?.kernel!==kernel||
         cell.model.sharedModel.getSource()!==source)return;
      const content=reply.content;
      if(content.status==='ok'&&content.found&&typeof content.data?.['text/plain']==='string'){
        documentation=content.data['text/plain'];
        if(documentation.trim())break;
      }
    }
    const body=new Widget({node:document.createElement('pre')});
    body.node.textContent=documentation
      ?documentation.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').slice(0,16000)
      :'No documentation found at the cursor. Place the cursor inside a function or object name, and run any required imports first.';
    Object.assign(body.node.style,{whiteSpace:'pre-wrap',overflowWrap:'anywhere',
      maxHeight:'55vh',maxWidth:'70vw',overflow:'auto',fontSize:'var(--jp-code-font-size)'});
    await showDialog({title:'Python contextual help',body,buttons:[Dialog.okButton({label:'Close'})]});
  });
  button('Variables','Inspect the current Python namespace',async()=>{
    await app.commands.execute('jupyterlite-touch-tools:show-variables',{widgetId:panel.id});
  });
  const editCommand=command=>async cell=>{
    const editor=await focusCode(cell);
    if(editor?.execCommand)editor.execCommand(command);
  };
  button('Indent','Indent selected Python lines',editCommand(indentMore));
  button('Dedent','Dedent selected Python lines',editCommand(indentLess));
  // JupyterLab's CodeMirror editor uses the shared Yjs model for history,
  // not CodeMirror's independent history extension. Use its public methods.
  button('Undo','Undo the latest code edit',async cell=>{
    const editor=await focusCode(cell);
    editor?.undo();
  });
  button('Redo','Redo the latest code edit',async cell=>{
    const editor=await focusCode(cell);
    editor?.redo();
  });
  button('Edit Markdown','Edit the selected Markdown cell',async cell=>{
    cell=await readyCell(cell);
    if(!cell||cell.model.type!=='markdown')return;
    app.shell.activateById(panel.id);
    notebook.mode='edit';
    cell.rendered=false;
    cell.editor?.focus();
  });
  button('Render Markdown','Render only the active Markdown cell, without running Python',async cell=>{
    cell=await readyCell(cell);
    if(!cell||cell.model.type!=='markdown')return;
    notebook.mode='command';
    cell.rendered=true;
  });
  bar.node.append(status);
  function refresh(){
    const cell=notebook.activeCell;
    const code=cell?.model.type==='code';
    const markdown=cell?.model.type==='markdown';
    const editable=canEdit(cell);
    for(const name of ['Complete','Help','Indent','Dedent','Undo','Redo']){
      const b=buttons.get(name);
      b.hidden=!code;
      b.disabled=!editable||(name==='Complete'&&!app.commands.hasCommand(COMPLETE));
    }
    buttons.get('Variables').hidden=!app.commands.hasCommand('jupyterlite-touch-tools:show-variables');
    for(const name of ['Edit Markdown','Render Markdown']){
      const b=buttons.get(name);b.hidden=!markdown;b.disabled=!editable;
    }
  }
  notebook.activeCellChanged.connect(refresh,bar);
  notebook.viewOnlyChanged.connect(refresh,bar);
  panel.context.model.stateChanged.connect(refresh,bar);
  app.commands.commandChanged.connect(refresh,bar);
  panel.contentHeader.addWidget(bar);
  panel.contentHeader.fit();
  panel.fit();
  refresh();
  void panel.context.ready.then(()=>{if(!bar.isDisposed)refresh();});
}

export default {
  id:'jupyterlite-touch-tools:editing',
  autoStart:true,
  requires:[INotebookTracker],
  activate(app,tracker){
    const installed=new WeakSet();
    const add=panel=>{
      if(!panel.isDisposed&&!installed.has(panel)){
        installed.add(panel);install(app,panel);
      }
    };
    tracker.forEach(add);
    tracker.widgetAdded.connect((_,panel)=>add(panel));
  }
};
