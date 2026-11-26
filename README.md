# jupyterlite-google-drive

Experimental browser-only JupyterLab extension for JupyterLite. Version 0.3.0-alpha.3. No fork of JupyterLite, no backend. Target: JupyterLite 0.8 / JupyterLab 4.6.

## Status

Initial source prototype. The Drive API adapter has Node tests with mocked HTTP responses. CI build, seven unit tests, browser menu activation and Pages deployment passed in run [45866198530](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45866198530). The mocked Drive integration test also passed in [run 45867383860](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45867383860): two isolated browser contexts successfully imported the same notebook, saved an edit, rejected a stale write, and reopened the updated notebook. The project owner reported successful real Google connection after adding the account as a test user. A complete independently verified real Drive round trip is still outstanding. Not yet appropriate for production or sensitive files.

## Experimental Python output export

In a native Google Drive notebook with filesystem synchronization enabled, write ordinary Python files under `/drive/output/`, then choose File > Google Drive: Export Python output as new file. Confirm the selected file. The upload creates a **new** file in My Drive; no source is overwritten.

```python
from pathlib import Path
Path("/drive/output/risultati.csv").write_text("x,y\n1,2\n", encoding="utf-8")
```

The staging directory is shared by native notebooks within the connection and stored in memory, not in Google Drive or IndexedDB. Export needed files before reload or reconnect; reconnect/disconnect warns before discarding. Python can remove staged files. File names are restricted to safe ASCII basenames (not .ipynb). Limit: 5 MiB per file, 20 MiB total, 20 files. No folder creation or remote overwrite. Upload errors retain staged files; repeat attempts may create duplicate names if the server received the first upload but the response was lost. Browser tests use the real DriveFS bridge and a mocked Google multipart endpoint.

## Experimental mounted data access

In a native Google Drive notebook, File > Google Drive: Mount read-only data file (experimental) authorizes a regular file and exposes a session-scoped alias at `/drive/data/<safe-name>`. With JupyterLite filesystem synchronization enabled, ordinary Python `open` or pandas can read the remote data through the native ContentsManager/DriveFS bridge, without injecting its encoded contents into Python input history. The data are read-only, with the same 5 MiB limit and version checks. Aliases are shared by native notebooks within the connection and are cleared at reconnect or reload. Name collisions with other Drive IDs are rejected. This is not a full folder mount or persistent data dependency. The isolated Chromium test passed actual DriveFS reads and output export (CI run 45892804136). A second test runs the same workflow under a project URL prefix, without COOP/COEP headers, using a real controlling service worker. This emulates the GitHub Pages transport but does not replace a real Google account/browser acceptance test. Use the temporary import fallback when filesystem synchronization is unavailable.

## Experimental data access from Python

The project owner reported that the deployed native notebook workflow appears to work. The next increment adds File > Google Drive: Import data into Python. Start the selected notebook's Pyodide kernel, select a regular file via Google Picker, and explicitly confirm the transfer. The file is copied byte-for-byte into the running kernel at /tmp/jupyterlite-drive/<safe-name>. For example:

```python
import csv
with open("/tmp/jupyterlite-drive/dati.csv", newline="") as f:
    rows = list(csv.DictReader(f))
```

This first step is a read-only snapshot of Drive, not a mounted folder, not synchronized, and not persisted across kernel restart or browser refresh. Repeat import on another device. Existing temporary files are never silently overwritten; delete or rename them explicitly in Python to import again. 5 MiB per file; Google-native documents (Sheets, Docs, etc.), folders and notebooks are excluded. Export a Sheet as CSV first. No additional OAuth scope, no token in the Python kernel, no notebook cells inserted. Import runs a fixed Python file-writing routine after confirmation. The request asks the kernel not to store execution history, but Pyodide 0.8.7 internally runs cells with store_history=True, so the encoded data may remain in the kernel's input history until restart. Use only trusted kernels and non-sensitive data. Browser integration tests must pass before publishing.

## Experimental native mount

The new command Google Drive: Open native notebook (experimental) opens a selected disposable notebook on a separate Contents.IDrive mount. Standard JupyterLab save may write directly to Google Drive; JupyterLab's normal autosave may also apply. The 0.2 native editor has been deployed; this new 0.3 data branch is not yet deployed. Remote paths are session-only, not a persistent filesystem; no full sidebar, rename/delete, persistent checkpoints, or kernel filesystem compatibility is promised. Standard Save creates one session-only checkpoint in memory, containing the last persisted snapshot; restoring it is an explicit version-checked write. Checkpoints disappear when the native editor closes. A new Save local recovery copy command snapshots the current editor (including unsaved edits) into a unique notebook in local storage, without making a Drive request. It is not an automatic backup. A save-state guard compares the current editor with the actual uploaded snapshot so edits made during a request remain dirty. Reconnect/disconnect is blocked while native panels are open. Metadata refresh cannot silently adopt a changed remote version. Use the existing import/export commands for regular work. CI now attempts a native editor Ctrl+S round trip, stale-version rejection and local recovery with fake Google services; the [previous CI run](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45884339360) reached the conflict dialog only after executing a real Python cell and persisting its output. The dialog test needed correction because JupyterLab uses Close rather than OK. In [run 45884858283](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45884858283), all 21 unit tests, the build and the complete native-browser round trip passed, including Python output persistence, conflict refusal and local recovery. The next test delays an actual browser upload, edits the notebook in flight, then checks that the real JupyterLab autosave timer persists the newer edit without a second Ctrl+S. It also checks reopening on a separate browser and local recovery during an HTTP 503 outage. Real Drive acceptance remains outstanding.

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
python scripts/smoke_mount.py
python scripts/smoke_mount.py --transport service-worker
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000/lab/index.html` directly, not inside an iframe for the first test. The build script replaces generated extension and site directories and verifies federation assets and the demo notebook. Check build logs for the extension. The direct Python build dependencies are pinned to the versions observed in the successful CI run; transitive dependencies are not yet fully locked. For deployment, publish only dist, not secrets or local environments. An iframe may require additional browser popup/origin configuration and should be tested separately.

## Continuous integration and GitHub Pages

The Build and test workflow runs on pushes to main and pull requests. It checks JS syntax, runs unit tests, builds the extension with jupyter-builder (JupyterLab 4.6), builds JupyterLite, then starts Chromium against the site under a project URL prefix. It verifies the local demo notebook and eleven Google Drive menu commands. A separate browser integration test uses fake Google authorization, Picker and Drive HTTP responses with two independent browser contexts to exercise local import, remote update, stale-write rejection and reopening through the authorized notebook list. The native browser test executes a real Python cell using Pyodide and checks persistence of its output. Google authorization and HTTP Drive responses are simulated; no real Google login is asserted. The resulting static site is downloadable as a workflow artifact.

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

Access tokens are kept in JS memory, not persisted in storage or logged. They expire and require user-initiated reauthorization. Browser code is not an isolation boundary against other scripts in the same page; do not run untrusted notebooks/extensions in a connected session. Imported notebooks remain in browser storage after disconnect. The legacy import/export workflow has no automatic uploads. Native notebook editors can write automatically when JupyterLab autosave is enabled. No Drive delete operations. Listing is limited by the existing OAuth scope; no additional permissions are requested. Drive API access and Google OAuth policies must be checked before public release. The version check is best effort, not a transactional lock.

## References

- https://jupyterlite.readthedocs.io/en/stable/howto/extensions/frontend.html
- https://jupyterlite.readthedocs.io/en/stable/howto/configure/advanced/extensions.html
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/picker/guides/web-picker
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Roadmap

0.1: verified build and mocked browser round trip; 0.2-alpha.1: authorized notebook list; 0.2 next: native Contents.IDrive and auto-save with explicit conflict strategy (see [design](docs/native-drive.md)); 0.3-alpha.1: explicit binary snapshot import into the active Python kernel; next: authorized data listing and investigate transparent mounted data access; 1.0: public deployment, tests, privacy documentation and hardening.
