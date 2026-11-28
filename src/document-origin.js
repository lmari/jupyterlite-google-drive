// Preserve document labels (changing a JupyterLab title can rename the file)
// and their existing file-type icons. Use a separate tab decoration.
export function documentOrigin(path,linked,auth,driveName='GoogleDrive') {
  if(path.startsWith(driveName+':')) return 'remote';
  if(linked) return auth==='connected'?'linked':'linked-offline';
  return 'local';
}
const descriptions={
  local:'Local document: standard Save writes to browser storage.',
  linked:'Local copy linked to Google Drive: standard Save is local; use Google Drive Save to upload.',
  'linked-offline':'Local copy linked to Google Drive: authorization unavailable; standard Save is local.',
  remote:'Native Google Drive document: standard Save writes directly to Google Drive.'
};
const marker='Storage: ';
export function decorateDocument(title,origin) {
  if(title.dataset.driveOrigin!==origin) title.dataset={...title.dataset,driveOrigin:origin};
  const base=(title.caption||'').split('\n').filter(line=>!line.startsWith(marker)).join('\n');
  const caption=[base,marker+descriptions[origin]].filter(Boolean).join('\n');
  if(title.caption!==caption) title.caption=caption;
}
const glyphs={
  local:'<rect x="2" y="6" width="12" height="8" rx="1.5"/><path d="M4 10h8m-7 2h.01m2 0h.01"/>',
  linked:'<path d="M4.5 12.5h8a3 3 0 0 0 .1-6 4.5 4.5 0 0 0-8.6-.7 3.4 3.4 0 0 0 .5 6.7Z"/><path d="M8 9v5m-2-2 2 2 2-2"/>',
  'linked-offline':'<path d="M4.5 12.5h8a3 3 0 0 0 .1-6 4.5 4.5 0 0 0-8.6-.7 3.4 3.4 0 0 0 .5 6.7Z"/><path d="m3 3 10 10"/>',
  remote:'<path d="M4.5 12.5h8a3 3 0 0 0 .1-6 4.5 4.5 0 0 0-8.6-.7 3.4 3.4 0 0 0 .5 6.7Z"/><path d="M8 13V8m-2 2 2-2 2 2"/>'
};
export function installOriginStyles() {
  const style=document.createElement('style');
  style.id='jupyterlite-google-drive-origin-styles';
  const base='.lm-TabBar-tab[data-drive-origin] .lm-TabBar-tabLabel';
  style.textContent=base+'{display:flex;align-items:center;gap:4px}'+
    base+'::after{content:"";flex:0 0 15px;width:15px;height:15px;background-size:contain;background-repeat:no-repeat;background-position:center}'+
    Object.entries(glyphs).map(([origin,svg])=>{
      const color=origin==='local'||origin==='linked-offline'?'#888888':'#4285F4';
      const image='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>';
      return '.lm-TabBar-tab[data-drive-origin="'+origin+'"] .lm-TabBar-tabLabel::after{background-image:url("data:image/svg+xml,'+encodeURIComponent(image)+'")}';
    }).join('\n');
  document.head.append(style);
}
