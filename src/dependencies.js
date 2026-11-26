// A notebook is untrusted input. Only bounded flat aliases and Drive file
// identifiers are accepted; no credentials, URLs or executable instructions.
export const dependencyKey='jupyterlite_google_drive';
export const maxDependencies=20;
export function validateDependencies(value) {
  if(value===undefined||value===null)return [];
  if(!value||value.version!==1||!Array.isArray(value.dependencies)||value.dependencies.length>maxDependencies)
    throw new Error('Unsupported or invalid Google Drive dependency manifest.');
  const seen=new Set();
  return value.dependencies.map(d=>{
    if(!d||typeof d.path!=='string'||!/^data\/[A-Za-z0-9_][A-Za-z0-9._-]{0,179}$/.test(d.path)||
        /\.ipynb$/i.test(d.path)||typeof d.file_id!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(d.file_id)||seen.has(d.path))
      throw new Error('Invalid or duplicate Google Drive dependency path or file ID.');
    seen.add(d.path);
    return {path:d.path,file_id:d.file_id};
  });
}
export function makeManifest(dependencies) {
  return {version:1,dependencies:validateDependencies({version:1,dependencies})};
}
