const base = 'https://www.googleapis.com/drive/v3/files';
const upload = 'https://www.googleapis.com/upload/drive/v3/files';
export const scope = 'https://www.googleapis.com/auth/drive.file';
export function validateNotebook(value) {
  if (!value || value.nbformat !== 4 || !Array.isArray(value.cells) ||
      !value.metadata || typeof value.metadata !== 'object') {
    throw new Error('Expected a Jupyter notebook (nbformat 4).');
  }
  return value;
}
export function notebookName(name) {
  const clean = String(name).replace(/[\\/\x00-\x1f\x7f]/g, '_').trim();
  const safe = clean || 'Notebook';
  return /\.ipynb$/i.test(safe) ? safe : safe + '.ipynb';
}
export class DriveAPI {
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) {
    this.token = token; this.fetcher = fetcher;
  }
  async request(url, options = {}) {
    const response = await this.fetcher(url, {...options, headers: {
      ...options.headers, Authorization: 'Bearer ' + this.token()
    }});
    if (!response.ok) throw new Error(`Drive request failed (${response.status}). ${response.status === 401 ? 'Reconnect to Google Drive.' : ''}`);
    return response;
  }
  // drive.file limits the list to files the user has authorized or the app created.
  // Filter extensions locally: Drive's name contains query is a prefix search.
  async listNotebooks() {
    const notebooks = new Map();
    const seenTokens = new Set();
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: 'trashed = false',
        spaces: 'drive',
        corpora: 'user',
        pageSize: '100',
        orderBy: 'modifiedTime desc',
        fields: 'nextPageToken,incompleteSearch,files(id,name,modifiedTime,version,mimeType,capabilities(canEdit))'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await (await this.request(base + '?' + params)).json();
      if (page.incompleteSearch) throw new Error('Google Drive returned an incomplete search. Retry or use Open notebook.');
      for (const file of page.files ?? []) {
        if (typeof file.id === 'string' && typeof file.name === 'string' &&
            /\.ipynb$/i.test(file.name) && !file.mimeType?.startsWith('application/vnd.google-apps.')) {
          notebooks.set(file.id, file);
        }
      }
      pageToken = page.nextPageToken;
      if (pageToken && seenTokens.has(pageToken)) throw new Error('Drive repeated a page token; retry the listing.');
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return [...notebooks.values()];
  }
  async metadata(id) {
    return (await this.request(`${base}/${encodeURIComponent(id)}?fields=id,name,version,modifiedTime,trashed,mimeType,capabilities(canEdit)`)).json();
  }
  async read(id) {
    const before = await this.metadata(id);
    if (before.trashed || !/\.ipynb$/i.test(before.name)) throw new Error('Select a non-trashed .ipynb file.');
    const content = validateNotebook(await (await this.request(`${base}/${encodeURIComponent(id)}?alt=media`)).json());
    const after = await this.metadata(id);
    if (before.version !== after.version) throw new Error('File changed while opening; retry.');
    return {meta: after, content};
  }
  async update(id, version, content) {
    validateNotebook(content);
    const current = await this.metadata(id);
    if (current.trashed || current.capabilities?.canEdit === false || !version || current.version !== version) {
      throw new Error('Remote file changed or is not writable. Save as a new copy instead.');
    }
    // Best-effort conflict detection, not an atomic compare-and-swap.
    return (await this.request(`${upload}/${encodeURIComponent(id)}?uploadType=media&fields=id,name,version,modifiedTime`, {
      method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(content)
    })).json();
  }
  async create(name, content) {
    validateNotebook(content);
    const boundary = 'notebook_' + globalThis.crypto.randomUUID();
    const body = [ `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
      JSON.stringify({name: notebookName(name), mimeType: 'application/json'}),
      `--${boundary}`, 'Content-Type: application/json', '', JSON.stringify(content),
      `--${boundary}--`, '' ].join('\r\n');
    return (await this.request(`${upload}?uploadType=multipart&fields=id,name,version,modifiedTime`, {
      method: 'POST', headers: {'Content-Type': `multipart/related; boundary=${boundary}`}, body
    })).json();
  }
}
