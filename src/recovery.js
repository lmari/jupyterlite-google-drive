// Browser-only recovery: no Google API, no new permissions.
export function needsLeaveWarning({dirtyNative=false,pendingSave=false,temporaryOutputs=false}={}) {
  return dirtyNative || pendingSave || temporaryOutputs;
}
export function notebookBackupBytes(content) {
  return new TextEncoder().encode(JSON.stringify(content,null,2)+'\n');
}
export function downloadBytes(name,bytes,mime='application/octet-stream') {
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
  const link=document.createElement('a');
  link.href=url;link.download=name;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    globalThis.setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
