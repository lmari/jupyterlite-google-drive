// Pure presentation of independently observed editor and adapter state.
// "Saved" means this editor's latest acknowledged snapshot, not global
// synchronization or proof that another device has not edited the file.
export function describeSave({isNative=false,linked=false,dirty=false,info=null,failed=false,auth='disconnected'}={}) {
  if (!isNative) return {kind:dirty?'local-dirty':'local',text:linked
    ? 'Local copy — use Save to original to update Drive'
    : dirty?'Unsaved local changes':'Stored in browser (local notebook)'};
  if (!info?.loaded) return {kind:'loading',text:'Loading remote notebook'};
  if (info.busy) return {kind:'saving',text:'Saving to Google Drive…'};
  if (failed) return {kind:'failed',text:'Last save failed — keep edits or save a local recovery copy'};
  if (dirty) return {kind:'dirty',text:info.writable===false
    ? 'Unsaved changes — remote file is read-only'
    : auth!=='connected'?'Unsaved changes — authorization required':'Unsaved remote changes'};
  if (info.writable===false) return {kind:'readonly',text:'Remote file is read-only'};
  if (auth!=='connected') return {kind:'unavailable',text:'Authorization required — last loaded or saved snapshot'};
  if (info.lastSaved) return {kind:'saved',text:'Saved to Google Drive',at:info.lastSaved};
  return {kind:'loaded',text:'Loaded from Google Drive — no unsaved changes'};
}
