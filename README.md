# jupyterlite-google-drive

Experimental browser-only JupyterLab extension for JupyterLite. Version 0.6.0-beta.0 (classroom beta candidate). No fork of JupyterLite, no backend. Target: JupyterLite 0.8 / JupyterLab 4.6.

## Status

Experimental, not intended for sensitive files or production. The project owner has successfully connected a real Google account and reported the early native editor workflow working. The latest validated release (0.5 alpha 3) passed [47 unit tests and end-to-end browser tests](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45903501598), including live Python execution, both filesystem transports, notebook autosave and conflict recovery, binary export, same-account renewal and fresh-browser dependency restoration. CI uses real JupyterLite/Pyodide but mocked Google services. Full acceptance on GitHub Pages with real Google accounts remains outstanding.

[Open the published experimental demo](https://lmari.github.io/jupyterlite-google-drive/lab/index.html). See [Google Cloud setup](docs/google-cloud.md) for running your own deployment.

## Classroom beta candidate

The Italian guided notebook `primi-passi.ipynb` is included in the demo; the [student quickstart](docs/student-quickstart-it.md) explains the complete workflow. Advanced actions are grouped in a collapsible sidebar section. All existing File menu commands remain accessible. This candidate is not yet a classroom-ready release: complete the [real-account acceptance checklist](docs/acceptance.md) before pilot use. No new OAuth scopes or persistence changes.

## Google Drive workspace

Open File > Google Drive: Show workspace or the Drive tab in the left sidebar. The panel reports authorization state (not network health), the latest observed notebook save status (loading, loaded, saving, unsaved, acknowledged, read-only or failed), the current notebook's persistence mode, authorized notebooks after explicit refresh, mounted data paths and temporary output paths. Open an already-authorized notebook directly in the native editor, or use Picker to select another file. All existing File menu commands remain available. Native Save status refers to the current editor's acknowledged snapshot, not proof of global synchronization. A newer edit during upload remains unsaved. A remote save failure offers local recovery. Saving a new Drive copy of a native notebook does not change the original backing file. No extra OAuth scopes, persistent credentials, folder tree, or changes to remote save semantics. The authorization status updates on expiry; Renew authorization verifies the original account via Drive about.get and preserves native editors, mounted data and staged outputs. Switching accounts or disconnecting still requires closing native editors and confirming discard of temporary output. Actual Google account acceptance remains manual.

### Renewal without closing notebooks

Use File > Google Drive: Renew authorization (also in the sidebar). Choose the original Google account. The candidate token is checked against the current Drive permission ID before use; a different account is rejected without changing the workspace. A 401 marks authorization expired; retry failed saves explicitly after renewal. No additional OAuth scope, no refresh token, no automatic remote retry. This is still experimental until real Google account verification.

## Notebook data dependencies (0.5 alpha)

In a native remote notebook, mount the needed input files, then use **Add selected data dependency** and save. Each reference is added individually without replacing existing references, including those not currently mounted. **Remove recorded data dependency** removes only the notebook metadata reference, not a mounted file or its Drive original. **Remember mounted data in notebook** remains available for explicitly replacing the entire list with the session's current mounts. Only aliases and Drive file IDs are recorded in notebook metadata. The sidebar distinguishes mounted, not mounted, and conflicting aliases by both path and file ID. IDs are visible to anyone with access to the notebook; no tokens or file contents are included. In a new browser session open the notebook and explicitly choose **Restore notebook data dependencies**. Drive checks current access for every reference; no additional scopes or automatic grants. A missing file or alias collision aborts the entire restore. If a file is not authorized, select it through Picker and retry. Paths remain stable even after a remote rename. This preserves references to live inputs, not immutable dataset versions; the actual contents may change. The alias namespace remains shared among native notebooks within a browser session. Remove individual references to clear recorded dependencies without unmounting files. Temporary output files are not included.

## Experimental Python output export

In a native Google Drive notebook with filesystem synchronization enabled, write ordinary Python files under `/drive/output/`, then choose File > Google Drive: Export Python output as new file. Confirm the selected file. The upload creates a **new** file in My Drive; no source is overwritten.

```python
from pathlib import Path
Path("/drive/output/risultati.csv").write_text("x,y\n1,2\n", encoding="utf-8")
```

The staging directory is shared by native notebooks within the connection and stored in memory, not in Google Drive or IndexedDB. Export needed files before reload or reconnect; reconnect/disconnect warns before discarding. Python can remove staged files. File names are restricted to safe ASCII basenames (not .ipynb). Limit: 5 MiB per file, 20 MiB total, 20 files. No folder creation or remote overwrite. Upload errors retain staged files; repeat attempts may create duplicate names if the server received the first upload but the response was lost. Browser tests use the real DriveFS bridge and a mocked Google multipart endpoint.

## Experimental mounted data access

In a native Google Drive notebook, File > Google Drive: Mount read-only data file (experimental) authorizes a regular file and exposes a session-scoped alias at `/drive/data/<safe-name>`. With JupyterLite filesystem synchronization enabled, ordinary Python `open` or pandas can read the remote data through the native ContentsManager/DriveFS bridge, without injecting its encoded contents into Python input history. The data are read-only, with the same 5 MiB limit and version checks. Aliases are shared by native notebooks within the connection and are cleared at account switch, disconnect or reload. Same-account renewal preserves them. Name collisions with other Drive IDs are rejected. This is not a full folder mount. Notebook dependency metadata can preserve references to these aliases. The isolated Chromium test passed actual DriveFS reads and output export (CI run 45892804136). The same workflow has also passed under a project URL prefix, without COOP/COEP headers, using a real controlling service worker. This emulates the GitHub Pages transport but does not replace a real Google account/browser acceptance test. Use the temporary import fallback when filesystem synchronization is unavailable.

## Experimental data access from Python

The project owner reported that the deployed native notebook workflow appears to work. The next increment adds File > Google Drive: Import data into Python. Start the selected notebook's Pyodide kernel, select a regular file via Google Picker, and explicitly confirm the transfer. The file is copied byte-for-byte into the running kernel at /tmp/jupyterlite-drive/<safe-name>. For example:

```python
import csv
with open("/tmp/jupyterlite-drive/dati.csv", newline="") as f:
    rows = list(csv.DictReader(f))
```

This first step is a read-only snapshot of Drive, not a mounted folder, not synchronized, and not persisted across kernel restart or browser refresh. Repeat import on another device. Existing temporary files are never silently overwritten; delete or rename them explicitly in Python to import again. 5 MiB per file; Google-native documents (Sheets, Docs, etc.), folders and notebooks are excluded. Export a Sheet as CSV first. No additional OAuth scope, no token in the Python kernel, no notebook cells inserted. Import runs a fixed Python file-writing routine after confirmation. The request asks the kernel not to store execution history, but Pyodide 0.8.7 internally runs cells with store_history=True, so the encoded data may remain in the kernel's input history until restart. Use only trusted kernels and non-sensitive data. Browser integration tests must pass before publishing.

## Recovery without Google access

Use **Download notebook recovery file** to download the current live notebook as an .ipynb, including unsaved edits. Use **Download Python output locally** to download staged binary or text output. Both work without a valid Google token and do not write to Drive. Save local recovery copy remains available for a browser-storage copy. Downloads do not mark files as saved or remove staged output. A browser leave-page warning is requested if a native editor is dirty, an upload is pending or temporary outputs exist. Browsers can suppress this warning; it is not an automatic backup and cannot protect against crashes. Export or download work before reloading.

See [real-account acceptance checklist](docs/acceptance.md) before classroom use.

## Notebook persistence modes

**Native remote editor (experimental).** Open native notebook (experimental) via Picker, or open an authorized notebook from the sidebar list. Ctrl+S and JupyterLab autosave write to the original Drive file. Remote version checks reject detected concurrent edits; these checks are best effort, not atomic. An edit during an upload remains unsaved until a later save. One checkpoint of the last persisted content is kept in memory per open editor. Checkpoints disappear on close. Save local recovery copy snapshots the live editor into a unique local notebook without contacting Google. Save a new copy creates a distinct file and does not redirect the native editor. Rename, remote deletion and full folder browsing are not supported. Close native editors before switching accounts or disconnecting; same-account renewal preserves them.

**Local-copy workflow.** Open notebook or Browse authorized notebooks imports a separate local copy, linked to the remote ID/version for the current editor. Ctrl+S saves to browser storage. Save to original explicitly writes to Drive with confirmation and version checking; Save a new copy creates a new file. The link is lost on reload, closing the editor or switching accounts. Disconnect never deletes local notebooks.

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
