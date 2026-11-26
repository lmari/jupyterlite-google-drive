# jupyterlite-google-drive

Experimental browser-only JupyterLab extension for JupyterLite. Version 0.1.0-alpha.1. No fork of JupyterLite, no backend. Target: JupyterLite 0.8 / JupyterLab 4.6.

## Status

Initial source prototype. The Drive API adapter has Node tests with mocked HTTP responses. The extension build and real browser OAuth/Picker integration have not been verified. Not yet appropriate for production or sensitive files.

## Workflow

The File menu contains five Google Drive commands: Connect, Open notebook, Save to original, Save a new copy, Disconnect. Open imports a notebook into a unique local JupyterLite file, then remembers the remote file ID and version for the open editor only. Standard Ctrl+S is local; remote writes are explicit. The original is overwritten only after confirmation and a best-effort remote version check. The link is lost on reload, closing the editor, or reconnecting; reopen from Drive (or export a new copy). Disconnect does not delete local files. No live synchronization or native Drive file browser yet.

## Google Cloud setup

1. Create a Google Cloud project; enable Google Drive API and Google Picker API.
2. Configure Google Auth Platform consent and add your account as a test user (external/testing, if appropriate).
3. Create an OAuth client ID of type Web application. Set Authorized JavaScript origins to `http://localhost:8000` and later the exact deployed HTTPS origin (e.g. `https://lmari.github.io`; no path). No client secret is needed or should be published.
4. Create an API key restricted to the appropriate web referrers and Picker API. Get the numeric Google Cloud project number (Picker app ID, not project name). All credentials must belong to the same project.
5. Copy `demo/jupyter-lite.example.json` to `demo/jupyter-lite.json` and fill the three values as strings. `drive.file` only grants access to files created by the app or explicitly selected/authorized. No broad Drive scope.

## Build and smoke test (proposed; not yet run end-to-end)

Requires Python 3.10+ and Node.js 22. From project root:

```sh
python -m venv .venv
source .venv/bin/activate
pip install 'jupyterlab>=4.6,<4.7' 'jupyterlite-core>=0.8,<0.9' 'jupyterlite-pyodide-kernel>=0.8,<0.9'
npm install
npm test
npm run build
mkdir -p .extra-labextensions
cp -a labextension .extra-labextensions/jupyterlite-google-drive
jupyter lite build --lite-dir demo --output-dir dist --FederatedExtensionAddon.extra_labextensions_path="$(pwd)/.extra-labextensions"
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000/lab/index.html` directly, not inside an iframe for the first test. If rebuilding, remove the old `.extra-labextensions/jupyterlite-google-drive` before copying. Check build logs for the extension. The dependency ranges are proposed; lock versions once a clean build passes. For deployment, publish only dist, not secrets or local environments. An iframe may require additional browser popup/origin configuration and should be tested separately.

## Acceptance test

- Connect using a test account; deny consent and verify recoverable error.
- Select a disposable notebook with Picker. Run a cell, edit it and use Save to original.
- Open from a second browser, authorize the same account, verify the edited notebook.
- Open the same notebook in both browsers, save from A, then try saving from B: B must refuse a stale write. The check is not atomic; simultaneous writes can still race. Do not rely on it for collaborative editing.
- Save a new copy, verify a new Drive file. Reconnect with a different account: previous editor links must not survive. Verify a different account cannot read another user's private file.
- Verify expired-token behavior and local copy recovery. Verify wrong file type and cancelled Picker.

## Security / limitations

Access tokens are kept in JS memory, not persisted in storage or logged. They expire and require user-initiated reauthorization. Browser code is not an isolation boundary against other scripts in the same page; do not run untrusted notebooks/extensions in a connected session. Imported notebooks remain in browser storage after disconnect. No automatic uploads, delete operations, or file listing in this release. Drive API access and Google OAuth policies must be checked before public release. The version check is best effort, not a transactional lock.

## References

- https://jupyterlite.readthedocs.io/en/stable/howto/extensions/frontend.html
- https://jupyterlite.readthedocs.io/en/stable/howto/configure/advanced/extensions.html
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/picker/guides/web-picker
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Roadmap

0.1: verify build and browser round trip; 0.2: native Contents.IDrive and auto-save with explicit conflict strategy; 0.3: data file access from kernel; 1.0: public deployment, tests, privacy documentation and hardening.
