import {maxDataBytes} from './drive-api.js';

export function dataPath(name) {
  // Flat safe filename; no drive paths, shell syntax or traversal.
  let safe = String(name).normalize('NFKC').replace(/[^A-Za-z0-9._-]/g, '_');
  safe = safe.replace(/^\.+/, '').slice(0, 180) || 'data';
  return '/tmp/jupyterlite-drive/' + safe;
}
export function toBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxDataBytes) throw new Error('Invalid data or file too large.');
  let binary = '';
  for (let i=0;i<bytes.length;i+=0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i,i+0x4000));
  }
  return globalThis.btoa(binary);
}
export function transferCode(name, bytes) {
  const path = dataPath(name);
  // Only ASCII safe literals are interpolated. No notebook cells are changed,
  // no file content is evaluated, and no credentials cross the kernel boundary.
  // Exclusive file creation prevents silent overwrites.
  const code = [
    'def _jupyterlite_drive_import_data():',
    '    import base64, pathlib',
    '    path = pathlib.Path(' + JSON.stringify(path) + ')',
    '    path.parent.mkdir(parents=True, exist_ok=True)',
    '    with path.open("xb") as f:',
    '        f.write(base64.b64decode(' + JSON.stringify(toBase64(bytes)) + ', validate=True))',
    'try:',
    '    _jupyterlite_drive_import_data()',
    'finally:',
    '    del _jupyterlite_drive_import_data'
  ].join('\n');
  return {path,code};
}
export async function transferData(kernel,name,bytes) {
  if (!kernel || kernel.isDisposed || kernel.status !== 'idle') {
    throw new Error('Start the Python kernel and wait until it is idle, then retry.');
  }
  if (kernel.name !== 'python') throw new Error('This prototype supports the JupyterLite Pyodide Python kernel only.');
  const {path,code} = transferCode(name,bytes);
  const future = kernel.requestExecute({
    code, silent:true, store_history:false, allow_stdin:false, stop_on_error:true
  });
  const reply = await future.done;
  if (reply.content.status !== 'ok') {
    throw new Error(reply.content.ename === 'FileExistsError'
      ? 'A temporary file with this name already exists. Delete or rename it in Python before importing again.'
      : 'The Python kernel could not create the temporary data file.');
  }
  return path;
}
