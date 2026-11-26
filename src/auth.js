import {scope} from './drive-api.js';
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url;
    script.onload = resolve; script.onerror = () => reject(new Error('Cannot load ' + url));
    document.head.appendChild(script);
  });
}
export class GoogleAuth {
  #access = null; #expires = 0; #pending = false; #account = null;
  constructor(config, fetcher = globalThis.fetch.bind(globalThis)) { this.config = config; this.fetcher = fetcher; }
  async prepare() {
    if (!this.config.clientId || !this.config.apiKey || !this.config.appId) throw new Error('Google Cloud configuration is missing. See README.');
    if (!globalThis.google?.accounts?.oauth2) await loadScript('https://accounts.google.com/gsi/client');
    if (!globalThis.gapi) await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve,reject) => globalThis.gapi.load('picker', {callback: resolve, onerror: reject, timeout: 15000, ontimeout: reject}));
  }
  get status() {
    if (!this.#access) return 'disconnected';
    return Date.now() >= this.#expires ? 'expired' : 'connected';
  }
  token() {
    if (!this.#access || Date.now() >= this.#expires) throw new Error('Connect to Google Drive first (or reconnect after token expiry).');
    return this.#access;
  }
  get hasAccount() { return this.#account !== null; }
  invalidate(token) {
    if (token === this.#access) this.#expires = 0;
  }
  async #identify(token) {
    const response = await this.fetcher('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)',{
      headers:{Authorization:'Bearer '+token},cache:'no-store'
    });
    if (!response.ok) throw new Error('Cannot verify Google Drive account. Authorization was not changed.');
    const data=await response.json();
    const id=data?.user?.permissionId;
    if (typeof id!=='string' || !id.trim()) throw new Error('Google Drive did not identify the account. Authorization was not changed.');
    return id;
  }
  connect() { return this.#authorize(false); }
  renew() {
    if (!this.#account) return Promise.reject(new Error('Connect to Google Drive first.'));
    return this.#authorize(true);
  }
  #authorize(sameAccount) {
    if (this.#pending) return Promise.reject(new Error('Authorization already in progress.'));
    this.#pending = true;
    const previousAccount=this.#account;
    return new Promise((resolve, reject) => {
      let handled=false;
      const fail = () => { if (!handled) { handled=true; reject(new Error('Google authorization was cancelled or failed.')); } };
      try {
        const client = globalThis.google.accounts.oauth2.initTokenClient({
          client_id: this.config.clientId, scope, include_granted_scopes: false,
          callback: async response => {
            if (handled) return;
            if (response.error || !response.access_token || !globalThis.google.accounts.oauth2.hasGrantedAllScopes(response, scope)) return fail();
            handled=true;
            const candidate=response.access_token;
            const expires=Date.now()+Math.max(0,Number(response.expires_in)-30)*1000;
            try {
              if (!Number.isFinite(expires) || expires<=Date.now()) throw new Error('Google returned an expired authorization.');
              const account=await this.#identify(candidate);
              if (sameAccount && account!==previousAccount) throw new Error('Different Google account selected. The existing workspace was preserved. Renew with the original account.');
              if (expires<=Date.now()) throw new Error('Authorization expired during account verification.');
              this.#access=candidate; this.#expires=expires; this.#account=account;
              resolve();
            } catch(e) { reject(e); }
          }, error_callback: fail
        });
        client.requestAccessToken({prompt:'select_account'});
      } catch (e) { handled=true; reject(e); }
    }).finally(() => { this.#pending = false; });
  }
  disconnect() {
    if (this.#pending) throw new Error('Authorization already in progress.');
    const token = this.#access; this.#access = null; this.#expires = 0; this.#account=null;
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
