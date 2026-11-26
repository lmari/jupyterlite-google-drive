import {scope} from './drive-api.js';
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url;
    script.onload = resolve; script.onerror = () => reject(new Error('Cannot load ' + url));
    document.head.appendChild(script);
  });
}
export class GoogleAuth {
  #access = null; #expires = 0; #pending = false;
  constructor(config) { this.config = config; }
  async prepare() {
    if (!this.config.clientId || !this.config.apiKey || !this.config.appId) throw new Error('Google Cloud configuration is missing. See README.');
    if (!globalThis.google?.accounts?.oauth2) await loadScript('https://accounts.google.com/gsi/client');
    if (!globalThis.gapi) await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve,reject) => globalThis.gapi.load('picker', {callback: resolve, onerror: reject, timeout: 15000, ontimeout: reject}));
  }
  token() {
    if (!this.#access || Date.now() >= this.#expires) throw new Error('Connect to Google Drive first (or reconnect after token expiry).');
    return this.#access;
  }
  connect() {
    if (this.#pending) return Promise.reject(new Error('Authorization already in progress.'));
    this.#pending = true;
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Google authorization was cancelled or failed.'));
      try {
        const client = globalThis.google.accounts.oauth2.initTokenClient({
          client_id: this.config.clientId, scope, include_granted_scopes: false,
          callback: response => {
            if (response.error || !response.access_token || !globalThis.google.accounts.oauth2.hasGrantedAllScopes(response, scope)) return fail();
            this.#access = response.access_token;
            this.#expires = Date.now() + Math.max(0, Number(response.expires_in) - 30) * 1000;
            resolve();
          }, error_callback: fail
        });
        client.requestAccessToken({prompt: 'select_account'});
      } catch (e) { reject(e); }
    }).finally(() => { this.#pending = false; });
  }
  disconnect() {
    const token = this.#access; this.#access = null; this.#expires = 0;
    if (token) globalThis.google.accounts.oauth2.revoke(token, () => {});
  }
  pick() {
    const token = this.token();
    return new Promise((resolve, reject) => {
      const p = globalThis.google.picker;
      const picker = new p.PickerBuilder().addView(new p.DocsView(p.ViewId.DOCS))
        .setOAuthToken(token).setDeveloperKey(this.config.apiKey).setAppId(this.config.appId)
        .setOrigin(window.location.origin).setCallback(data => {
          if (data[p.Response.ACTION] === p.Action.PICKED) {
            resolve(data[p.Response.DOCUMENTS][0][p.Document.ID]);
          } else if (data[p.Response.ACTION] === p.Action.CANCEL) resolve(null);
          else if (data[p.Response.ACTION] === p.Action.ERROR) reject(new Error('Google Picker failed.'));
        }).build();
      picker.setVisible(true);
    });
  }
}
