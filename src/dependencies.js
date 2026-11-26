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

export function addDependency(value, candidate) {
  const existing=validateDependencies(value);
  const [next]=validateDependencies(makeManifest([candidate]));
  const previous=existing.find(d=>d.path===next.path);
  if(previous && previous.file_id!==next.file_id)
    throw new Error('Dependency alias already refers to another file. Remove the recorded dependency first.');
  return makeManifest(previous?existing:[...existing,next]);
}
export function removeDependency(value,path) {
  return makeManifest(validateDependencies(value).filter(d=>d.path!==path));
}
// Compare both ID and alias; a matching name alone does not mean restored.
export function dependencyStatus(dependency,mounted) {
  const current=mounted.find(d=>d.path===dependency.path);
  return !current?'not-mounted':current.file_id===dependency.file_id?'mounted':'collision';
}
