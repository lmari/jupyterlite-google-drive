# jupyterlite-google-drive

Experimental browser-only JupyterLab extension for JupyterLite. Version 0.2.0-alpha.1. No fork of JupyterLite, no backend. Target: JupyterLite 0.8 / JupyterLab 4.6.

## Status

Initial source prototype. The Drive API adapter has Node tests with mocked HTTP responses. CI build, seven unit tests, browser menu activation and Pages deployment passed in run [45866198530](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45866198530). The mocked Drive integration test also passed in [run 45867383860](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45867383860): two isolated browser contexts successfully imported the same notebook, saved an edit, rejected a stale write, and reopened the updated notebook. The project owner reported successful real Google connection after adding the account as a test user. A complete independently verified real Drive round trip is still outstanding. Not yet appropriate for production or sensitive files.

## Workflow

The File menu contains six Google Drive commands: Connect, Open notebook, Browse authorized notebooks, Save to original, Save a new copy, Disconnect. The new Browse command lists the notebooks already accessible to the app through the drive.file scope, newest modified first. It fetches all pages, excludes other file types and disambiguates duplicate names with numbered choices. Use Open notebook (Picker) to authorize additional files. Open imports a notebook into a unique local JupyterLite file, then remembers the remote file ID and version for the open editor only. Standard Ctrl+S is local; remote writes are explicit. The original is overwritten only after confirmation and a best-effort remote version check. The link is lost on reload, closing the editor, or reconnecting; reopen from Drive (or export a new copy). Disconnect does not delete local files. This is a native JupyterLab selection dialog, not yet a mounted IDrive or a sidebar. No live synchronization or remote autosave yet.

## Google Cloud setup

See the detailed [step-by-step deployment guide](docs/google-cloud.md).

1. Create a Google Cloud project; enable Google Drive API and Google Picker API.
2. Configure Google Auth Platform consent and add your account as a test user (external/testing, if appropriate).
3. Create an OAuth client ID of type Web application. Set Authorized JavaScript origins to `http://localhost:8000` and later the exact deployed HTTPS origin (e.g. `https://lmari.github.io`; no path). No client secret is needed or should be published.
4. Create an API key restricted to the appropriate web referrers and Picker/Drive APIs; include the Picker iframe referrer `https://docs.google.com/*`. Get the numeric Google Cloud project number (Picker app ID, not project name). All credentials must belong to the same project.
5. Copy `demo/jupyter-lite.example.json` to `demo/jupyter-lite.json` and fill the three values as strings. `drive.file` only grants access to files created by the app or explicitly selected/authorized. No broad Drive scope.

## Build and smoke test

Requires Python 3.10+ and Node.js 22. From project root:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-build.txt
npm install
npm run check
npm test
python scripts/build_demo.py
python -m playwright install chromium
python scripts/smoke_browser.py
python scripts/smoke_drive.py
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000/lab/index.html` directly, not inside an iframe for the first test. The build script replaces generated extension and site directories and verifies federation assets and the demo notebook. Check build logs for the extension. The direct Python build dependencies are pinned to the versions observed in the successful CI run; transitive dependencies are not yet fully locked. For deployment, publish only dist, not secrets or local environments. An iframe may require additional browser popup/origin configuration and should be tested separately.

## Continuous integration and GitHub Pages

The Build and test workflow runs on pushes to main and pull requests. It checks JS syntax, runs unit tests, builds the extension with jupyter-builder (JupyterLab 4.6), builds JupyterLite, then starts Chromium against the site under a project URL prefix. It verifies the local demo notebook and six Google Drive menu commands. A separate browser integration test uses fake Google authorization, Picker and Drive HTTP responses with two independent browser contexts to exercise local import, remote update, stale-write rejection and reopening through the authorized notebook list. No real Google login or Python cell execution is asserted by these tests. The resulting static site is downloadable as a workflow artifact.

To publish a demo, set Settings > Pages > Source to GitHub Actions. Then either run the Build and test workflow manually with its deploy option or create repository Actions variable PAGES_ENABLED=true for automatic deployment on pushes to main. The deployment job only runs after the build and browser checks pass.

For cloud functionality set Actions repository variables GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_API_KEY and GOOGLE_DRIVE_APP_ID to the public configuration values from the Google Cloud setup section. All three are required together. Restrict the key and authorized origins in Google Cloud; these values appear in the static site by design. Never add a client secret. With no variables the demo builds with cloud access disabled. For local builds the variables can be provided in the shell or the runtime JSON file.

Expected URL: https://lmari.github.io/jupyterlite-google-drive/lab/index.html

## Acceptance test

- Connect using a test account; deny consent and verify recoverable error.
- Select a disposable notebook with Picker. Run a cell, edit it and use Save to original.
- Open from a second browser, authorize the same account, verify the edited notebook.
- Open the same notebook in both browsers, save from A, then try saving from B: B must refuse a stale write. The check is not atomic; simultaneous writes can still race. Do not rely on it for collaborative editing.
- Save a new copy, verify a new Drive file. Reconnect with a different account: previous editor links must not survive. Verify a different account cannot read another user's private file.
- Verify expired-token behavior and local copy recovery. Verify wrong file type and cancelled Picker.

## Security / limitations

Access tokens are kept in JS memory, not persisted in storage or logged. They expire and require user-initiated reauthorization. Browser code is not an isolation boundary against other scripts in the same page; do not run untrusted notebooks/extensions in a connected session. Imported notebooks remain in browser storage after disconnect. No automatic uploads or delete operations. Listing is limited by the existing OAuth scope; no additional permissions are requested. Drive API access and Google OAuth policies must be checked before public release. The version check is best effort, not a transactional lock.

## References

- https://jupyterlite.readthedocs.io/en/stable/howto/extensions/frontend.html
- https://jupyterlite.readthedocs.io/en/stable/howto/configure/advanced/extensions.html
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/picker/guides/web-picker
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Roadmap

0.1: verified build and mocked browser round trip; 0.2-alpha.1: authorized notebook list; 0.2 next: native Contents.IDrive and auto-save with explicit conflict strategy (see [design](docs/native-drive.md)); 0.3: data file access from kernel; 1.0: public deployment, tests, privacy documentation and hardening.
