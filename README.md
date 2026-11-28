# jupyterlite-google-drive

A browser-only JupyterLab extension for JupyterLite that connects Python notebooks and their data to Google Drive. Work in a web browser, keep notebooks on Drive, and resume work on another device. No JupyterLite fork, application backend, or local Python installation is required for end users.

**Current version: 0.6.0-beta.10 (experimental candidate).** Built for JupyterLite 0.9.0b2, JupyterLab 4.7.0b2, Pyodide kernel 0.9.0b0 and Lumino Widgets 2.10.0.

**[Open the live demo](https://lmari.github.io/jupyterlite-google-drive/lab/index.html)** · [Student quickstart (Italian)](docs/student-quickstart-it.md) · [Install the extension](docs/distribution.md) · [Google Cloud setup](#google-cloud-setup)

## Status and scope

The preceding validated deployment passed [49 unit tests, browser integration tests and independent wheel installation](https://github.com/lmari/jupyterlite-google-drive/actions/runs/46139838722), including actual Python execution and both JupyterLite filesystem transports. The preceding version passed editing, variable snapshot and Drive regression tests and was deployed. [Comparative touch tests](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45910895067) also passed in touch-enabled Chromium and Firefox after the runtime upgrade. These tests use desktop browser engines and mocked Google services, not physical tablets or real Google accounts. A real Google account has been used successfully during development; full acceptance of the current release remains outstanding.

This is an experimental classroom candidate. Use disposable notebooks and non-sensitive data; do not rely on it for production, sensitive information or collaborative editing. See the [real-account acceptance checklist](docs/acceptance.md).

## Quickstart

If you are using an existing deployment, the site operator must configure Google Cloud; end users do not need to create their own Cloud project.

1. Open the demo directly in a browser. Try the local notebook `welcome.ipynb` or the guided Italian exercise `primi-passi.ipynb`.
2. Choose **File > Google Drive > Connect**, then **Open folder**, or open the **Drive** tab in the left sidebar.
3. Choose **Connect to Google Drive** and authorize the app with an eligible Google account.
4. To open an existing remote notebook, choose **Choose notebook from Drive…** and select an `.ipynb` in Google Picker. Alternatively, refresh the list of authorized notebooks and open one from the list.
5. To start from a local notebook, use **Save notebook as new Drive copy**. Refresh the authorized notebook list, then open the new remote copy. The original local editor remains local.
6. Run cells as usual. In a native remote notebook, standard Save (Ctrl+S) and JupyterLab autosave write to the original Drive file. Check the sidebar for the acknowledged save status before leaving.
7. For input files and output files, follow the workflows below. To resume on another device, authorize the same account, open the remote notebook and explicitly restore its recorded data dependencies.

Use the sidebar for routine operations. The **File > Google Drive** submenu provides everyday commands; **File > Google Drive (advanced)** contains local-copy, recovery and other less frequent operations. Both contain the same underlying commands used by the sidebar.

## Notebook editing tools

A separate frontend plugin, packaged with the Drive extension, adds a compact editing toolbar to every notebook, including unconfigured local notebooks. Select a code cell to use **Complete**, **Help**, **Indent**, **Dedent**, **Undo** and **Redo**. Complete uses JupyterLab's native completion provider; execute imports first so the Python kernel can inspect available objects. **Ctrl+Space** invokes the same completion inside a code cell; the standard Tab shortcut remains available. Help sends a native kernel inspection request and displays its plain-text documentation in the right Help sidebar, labeled with the notebook of origin. Choose **Open in window** to read the same text in a scrollable dialog; if the sidebar cannot be displayed, the dialog opens directly. Help is a snapshot of the requested cursor, not a live documentation feed. Select a Markdown cell to use **Edit Markdown** or **Render Markdown** without a physical keyboard; rendering affects only the active Markdown cell, never adjacent Python code. The plugin uses native CodeMirror commands and JupyterLab services, not an external AI or language server. Availability of completions and documentation depends on the kernel. Physical tablet acceptance remains pending.

## Python variables

Choose **Variables** in the editing toolbar to open a touch-friendly dialog for the notebook that owns the toolbar. If its Pyodide kernel is idle, opening the dialog requests a snapshot immediately; otherwise start the kernel, run code and reopen it. The **Refresh variables** button explicitly obtains a new snapshot when the kernel is idle. The separate **Variables** tab on the right remains available for a persistent sidebar view while editing on larger screens. It shows names, types and bounded previews (up to 100 variables; short lists and tuples, scalar values, and summaries for other containers). Arbitrary objects are not evaluated or formatted using their custom repr methods. Refresh is explicit; running code marks the snapshot potentially outdated, and a notebook or kernel change clears it. The inspection uses a fixed local Python request, not a new notebook cell or an external service. Pyodide may record the inspection request in IPython history despite the request not to store it. No variables are saved to Drive or persisted by the inspector. Use only trusted kernels and non-sensitive data.

## Notebook persistence

| Mode | Open or create | What standard Save does |
|---|---|---|
| Native remote editor (recommended for the experiment) | Choose notebook from Drive or open from the authorized list | Writes to the original Drive notebook, including autosave |
| Local notebook | Create a notebook with JupyterLab | Saves in browser storage |
| Local copy of a remote notebook | Advanced > Open notebook or Browse authorized notebooks | Saves locally; use Save to original to update the linked Drive file explicitly |

The native editor uses a remote ContentsManager drive, not an automatically synchronized local folder. The sidebar distinguishes loaded, saving, unsaved, acknowledged, read-only and failed states. An edit made during an upload remains unsaved until another save. **Save a new copy** creates a distinct file in the current JupyterLite folder; it does not change the original editor's backing file.

Native saves and explicit Save to original check the remote file version to reject detected stale writes. This is best-effort conflict detection, not an atomic lock: simultaneous writes can race. Avoid editing the same notebook concurrently. A native editor keeps a single session-only checkpoint of persisted content. Remote rename, deletion and full folder browsing are not supported. The local-copy link is lost when its editor closes, on reload or account switch; local notebook files remain in browser storage.

### Authorization and recovery

**Renew authorization** requests a new access token for the same Google account without closing notebooks or discarding mounted inputs and staged outputs. A different account is rejected; after renewal, retry any failed save explicitly. Switching accounts or disconnecting requires closing native notebooks and confirming discard of temporary outputs.

If a remote save fails or Google access is unavailable:

- **Download notebook recovery file** downloads the live notebook, including unsaved edits, as an `.ipynb`.
- **Save local recovery copy** creates a separate notebook in browser storage.
- **Download Python output locally** downloads a staged file without contacting Google.

Recovery does not mark the remote notebook as saved or remove staged output. The browser may show a leave-page warning for unsaved native changes, a pending upload or temporary outputs; browsers can suppress it. It is not a backup. Download or export important work before closing or reloading.

## Working with Python data

### Mount read-only inputs

In a native remote notebook, choose **Mount data file…** in the sidebar and select a regular data file (for example a CSV) through Picker. With JupyterLite filesystem synchronization available, Python can read it at `/drive/data/<safe-name>`:

```python
import csv

with open("/drive/data/dati.csv", newline="") as f:
    rows = list(csv.DictReader(f))
```

Mounted files are read-only and read from Drive on access, with size and version checks. The namespace is shared by native notebooks in the current browser session. Filenames are sanitized, and a collision between different Drive file IDs is rejected. Mounts are cleared on reload, disconnect or account switch, but survive same-account authorization renewal.

The limit is 5 MiB per data file. Google-native documents (Sheets, Docs, etc.), folders and notebooks are not supported as data files. Export a Sheet as CSV first. This is not a full Drive folder mount.

### Record and restore notebook dependencies

After mounting an input, choose **Add selected dependency…**, select the file and save the notebook. Repeat for each needed input. The metadata stores the alias and Drive file ID, not its contents or access token.

In a new session or on another device, open the notebook and choose **Restore notebook data dependencies**. Restore checks access to every recorded file, preserving aliases even after a remote rename; if any reference cannot be restored, the operation fails without partially mounting the list. If authorization is missing, select the file in Picker and retry. The sidebar displays whether each dependency is mounted, missing or has a conflicting alias.

Use **Remove recorded dependency…** to remove a reference without deleting or unmounting its source. **Replace with all mounted data…** explicitly replaces the entire list. A notebook records at most 20 dependencies. The recorded IDs are visible to readers of the notebook. Dependencies point to live files, not immutable dataset versions; rerunning the same code may produce different results. Python variables are rebuilt by running code, not transferred between devices.

### Export Python results

Write a file to the temporary output directory in a native notebook:

```python
from pathlib import Path

Path("/drive/output/risultati.csv").write_text(
    "x,y\n1,2\n", encoding="utf-8"
)
```

Choose **Export output to Drive…** or **Download output locally…** in the sidebar. Export always creates a new file in the current JupyterLite folder, never overwriting an existing file. The temporary source remains available. A lost upload response can lead to duplicate files on retry.

Outputs are held in memory, shared by native notebooks during the session, and are not automatically synchronized. They are lost on reload, disconnect or account switch; export or download them first. Limits: 5 MiB per file, 20 MiB in total, 20 files, flat safe filenames excluding notebooks.

### Temporary import fallback

If the native filesystem bridge is unavailable, start the notebook's Python kernel and choose **File > Google Drive (advanced) > Import data into Python**. Select and confirm a regular file. It is copied into the running kernel, under `/tmp/jupyterlite-drive/<safe-name>`:

```python
with open("/tmp/jupyterlite-drive/dati.csv", newline="") as f:
    rows = list(csv.DictReader(f))
```

This is a snapshot, not a mounted file. It is lost on kernel restart or browser refresh, and does not restore through notebook dependencies. Existing temporary files are not silently overwritten. The same 5 MiB input limit applies. A fixed Python writing routine transfers the bytes; the encoded contents may remain in kernel history, so use only non-sensitive data and trusted notebooks.

## Google Cloud setup

Only the owner of a deployment needs to complete this procedure. Google Identity Services uses OAuth 2.0 to authorize access to Drive, and Google Picker lets each user select files. All three configuration values must belong to the same Google Cloud project. No service account, server-side OAuth exchange, client secret, permanent refresh token or cloud compute instance is needed.

You can build and use local JupyterLite without setting up Google Cloud. Only the Drive features will be unavailable.

### 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. In the top bar, open the project selector and choose **New Project**. Give the project a recognizable name, such as `JupyterLite Google Drive`. Select an organization if required, then create the project.
3. Select the new project in the top bar. Keep it selected for all subsequent steps.

The project name, the textual project ID and the numeric project number are distinct. We will need the numeric project number in step 6.

### 2. Enable the APIs

1. Open [APIs & Services > Library](https://console.cloud.google.com/apis/library).
2. Search for **Google Drive API**, open its page and click **Enable**.
3. Return to the Library, search for **Google Picker API**, and enable it as well.
4. Under **Enabled APIs & services**, verify that both APIs are enabled for the selected project.

### 3. Configure Google Auth Platform

Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). If it has not been configured, choose **Get started**.

- **Branding:** enter the app name (e.g. `JupyterLite Google Drive`), a user support email address and a developer contact email address. Complete the initial setup and save. For a public app, complete the additional branding and policy fields required by Google.
- **Audience:** for personal testing with a Gmail account, choose **External** and keep the publishing status **Testing**. Under **Test users**, click **Add users**, enter the exact email address of the Google account that will use Drive, and save. Repeat for each permitted tester. An Internal audience is an option only for eligible Workspace organizations and their members.
- **Data Access:** click **Add or remove scopes**, search for or manually enter `https://www.googleapis.com/auth/drive.file`, select it, update and save. Do not select full Drive access (`https://www.googleapis.com/auth/drive`).

The `drive.file` scope lets the app work with files it creates or files the user specifically authorizes through Picker. It does not grant blanket access to all Drive files. The authorized-notebook list is therefore intentionally incomplete until you select additional files.

If the consent flow says the app is in testing and your account is not permitted, check the selected Google account, the project and the Test users list before trying again. Do not work around a blocked account by increasing OAuth scopes or removing restrictions. For institutional accounts, the Workspace administrator may need to allow the app.

### 4. Create an OAuth client ID

1. In Google Auth Platform, open [Clients](https://console.cloud.google.com/auth/clients) and choose **Create client** (alternatively, APIs & Services > Credentials > Create credentials > OAuth client ID).
2. Select **Web application**, and enter a descriptive name.
3. Under **Authorized JavaScript origins**, add the origins at which the application will run. For the project demo and local development, use:

```text
https://lmari.github.io
http://localhost
http://localhost:8000
```

For your own fork, replace `https://lmari.github.io` with your actual hosting origin, e.g. `https://YOUR-USERNAME.github.io`. An origin is the scheme, host and optional port only. Do not include `/jupyterlite-google-drive/lab/index.html`, any path, query, wildcard or trailing slash. Add only the origins you use.

4. Leave **Authorized redirect URIs** empty: this app uses the browser token model, not an OAuth redirect flow.
5. Click **Create** and copy the **Client ID**, which ends in `.apps.googleusercontent.com`. Do not copy or publish the client secret.

### 5. Create and restrict a browser API key

1. Open [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials), choose **Create credentials > API key**, and create a standard API key (not a service-account authorization key).
2. Open the key's settings. Give it a recognizable name and under **Application restrictions** select **Websites**.
3. Under website restrictions, add the following example referrers, replacing the GitHub Pages host with your own when applicable:

```text
https://lmari.github.io/*
https://docs.google.com/*
http://localhost:8000/*
```

The `docs.google.com` entry is essential: Google Picker runs in an iframe served from that host. Add the localhost entry only if testing locally.

4. Under **API restrictions**, choose **Restrict key** and select **Google Picker API** and **Google Drive API**. Save the settings.
5. Copy the API key. Keep it restricted; never deploy an unrestricted key.

The API key is a public browser configuration value, not a substitute for the user's OAuth token. Restrictions help prevent unauthorized use and quota consumption.

### 6. Find the numeric project number

Open the project dashboard or [IAM & Admin > Settings](https://console.cloud.google.com/iam-admin/settings). Locate **Project number**, a string of digits. This is the Google Picker App ID. Do not use the project name, textual project ID, OAuth client ID or API key in its place.

At this point you should have:

| Google Cloud value | Runtime JSON property | Build / GitHub Actions variable |
|---|---|---|
| OAuth web client ID | googleDriveClientId | GOOGLE_DRIVE_CLIENT_ID |
| Restricted browser API key | googleDriveApiKey | GOOGLE_DRIVE_API_KEY |
| Numeric project number | googleDriveAppId | GOOGLE_DRIVE_APP_ID |

### 7. Configure the application

**Option A: deploy on GitHub Pages (recommended for access from multiple devices).**

1. Fork or use your own copy of this repository. Open its **Settings > Secrets and variables > Actions > Variables** tab (for the original repository: [Actions variables](https://github.com/lmari/jupyterlite-google-drive/settings/variables/actions)).
2. Use **New repository variable** to add the three variables listed in the table above. Paste their corresponding values, without extra quotes or spaces.
3. Under **Settings > Pages**, set **Source** to **GitHub Actions**.
4. To deploy automatically after successful builds on `main`, add a fourth Actions repository variable named `PAGES_ENABLED` with the value `true`. For the first deployment, or a manual rebuild, open **Actions > Build and test > Run workflow**, select `main`, enable the 'deploy' option, and run it.
5. Check that both the build and deploy jobs finish successfully. Open the Pages URL, e.g. `https://YOUR-USERNAME.github.io/jupyterlite-google-drive/lab/index.html`. If the repository name differs, adapt the path accordingly. A first-time Pages setup may require committing the workflow or enabling Actions on a fork.

The build script injects the three public variables into the generated `dist/jupyter-lite.json`. Changing the variables requires a new build and deployment. None of these variables should contain a client secret, account password or access token. They are visible in the static site by design.

**Option B: build and run locally.**

From the repository root, copy the example:

```sh
cp demo/jupyter-lite.example.json demo/jupyter-lite.json
```

Edit `demo/jupyter-lite.json`, substituting your three real configuration values (all are JSON strings, including the numeric project number):

```json
{
  "jupyter-config-data": {
    "googleDriveClientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
    "googleDriveApiKey": "YOUR_RESTRICTED_API_KEY",
    "googleDriveAppId": "YOUR_NUMERIC_PROJECT_NUMBER"
  }
}
```

This local configuration file is ignored by Git. Follow the [build instructions](#build-and-smoke-test) and open `http://localhost:8000/lab/index.html`. Alternatively, export the three build environment variables before running `python scripts/build_demo.py`; supply all three together. The environment values override the corresponding JSON configuration in the generated site.

For a separate JupyterLite installation using the wheel, put the same JSON configuration in the site directory's `jupyter-lite.json` before building. See [distribution](docs/distribution.md). For any public deployment use HTTPS and configure its exact origin, not merely the origin of the original demo.

### 8. Verify the setup

1. Open the site directly, not embedded in another page, using the account you added as a tester.
2. Open the Drive sidebar. It should show **Not connected**, rather than **Configuration unavailable**.
3. Choose **Connect to Google Drive**, select the correct account, and grant the requested permission.
4. Use **Save notebook as new Drive copy** on a disposable local notebook. Verify that a new `.ipynb` appears in the current JupyterLite folder.
5. Refresh the notebook list, open the new file natively, edit and run a cell, and save. Check the acknowledgment.
6. On another browser or device, authorize the same account and reopen the saved notebook. Verify the edit and output. Continue with the [acceptance checklist](docs/acceptance.md).

If authorization or Picker fails, see [Google Cloud troubleshooting and deployment notes](docs/google-cloud.md). Before allowing broader access, review Google's OAuth policies, user limits and verification requirements; testing mode is not a general public rollout.

## Build and smoke test

End users need only a browser. To build this repository, use Python 3.11 or later and Node.js 22 or later. The direct dependency versions are specified in `requirements-build.txt` and `package.json`; the transitive dependency graph is not fully locked.

```sh
git clone https://github.com/lmari/jupyterlite-google-drive.git
cd jupyterlite-google-drive
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-build.txt build
npm install
npm run check
npm test
python scripts/build_demo.py
python -m playwright install chromium firefox
python scripts/smoke_browser.py
python scripts/smoke_editing.py
python scripts/smoke_variables_touch.py
python scripts/smoke_drive.py
python scripts/smoke_mount.py
python scripts/smoke_mount.py --transport service-worker
python scripts/smoke_touch.py
python -m http.server 8000 --directory dist
```

On Windows, activate the environment with `.venv\Scripts\activate`. On Linux, browser test dependencies may require `python -m playwright install --with-deps chromium firefox`. Open `http://localhost:8000/lab/index.html`. For a clean unconfigured smoke test, do not set OAuth configuration or add `demo/jupyter-lite.json` until after the tests.

The build generates `labextension/`, `.extra-labextensions/` and `dist/` and checks that the federated extension and both demo notebooks are included. Publish only `dist/`, not local environments or source build directories.

## Install into an independent JupyterLite site

Download the `jupyterlite-google-drive-wheel` artifact from a successful [GitHub Actions run](https://github.com/lmari/jupyterlite-google-drive/actions), extract the wheel, and install it in the **site builder's Python environment**, not a notebook kernel. Install compatible JupyterLite and Pyodide kernel versions, configure Google Cloud as above, and run a normal JupyterLite build. No Node.js is required when installing the prebuilt wheel.

The package contains frontend assets only. It does not include Google configuration. No PyPI or npm registry publication has been performed. See the [distribution guide](docs/distribution.md) for precise commands, including building a wheel from source.

## Continuous integration and deployment

The [Build and test workflow](.github/workflows/build.yml) runs on pushes to `main` and pull requests. It checks JavaScript syntax, unit tests, static site generation, menu activation, two-browser notebook persistence and conflict recovery, native Python execution, both DriveFS transports (shared memory and service worker), selected dependency restoration, binary output export, expired authorization recovery, and independent installation and execution from the wheel.

The [touch comparison workflow](.github/workflows/touch-comparison.yml) tests the two Drive submenus and native JupyterLab commands with touch events in Chromium and Firefox. See [touch experiment results](docs/touch-experiment.md). CI uses mocked Google APIs; passing CI is not evidence that a real Google account or physical tablet has passed acceptance.

A successful main build can publish to GitHub Pages using the configuration in step 7. Static demo and wheel artifacts are also available from successful runs.

## Security and limitations

- OAuth access tokens and account identity are kept in JavaScript memory, not persisted in browser storage. Authorization is initiated by the user; no refresh token is stored. The app asks for `drive.file` only.
- Browser code is not an isolation boundary against other scripts on the same origin. Do not run untrusted notebooks or extensions in a connected session. A GitHub Pages project path is not a separate origin from other sites under the same host. Prefer a dedicated trusted origin for broader deployment.
- Local notebooks remain in browser storage after disconnect. Native notebook autosave can write to Drive. Remote writes are not transactional; no collaborative locking is provided.
- Mounted inputs are read-only, scoped to the current session, and subject to size limits. Output files are volatile until explicitly exported or downloaded.
- The extension does not implement full Drive browsing, remote rename or deletion. Recorded file IDs are visible to readers of a notebook.
- Real Google-account and physical-tablet tests are required before routine classroom use. Public release also requires appropriate privacy documentation and compliance with Google's OAuth policies.

## Further development

Priorities are real-account and tablet acceptance, usability for touch devices, accessibility, reproducible builds and documentation, and release/privacy hardening. See [GitHub Issues](https://github.com/lmari/jupyterlite-google-drive/issues) for development work. See the [native drive design](docs/native-drive.md) for architectural background.

## References

- [JupyterLite frontend extensions](https://jupyterlite.readthedocs.io/en/stable/howto/extensions/frontend.html)
- [Google OAuth consent and scopes](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Picker integration](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Cloud API key restrictions](https://docs.cloud.google.com/docs/authentication/api-keys)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)

License: [BSD 3-Clause](LICENSE).

**Folder browser (beta 9):** File > Google Drive > Open folder displays only the folder contents and navigation controls. To view save status, mounted data, dependencies and local recovery actions, use File > Google Drive (advanced) > Notebook and data status.

**Beta 10:** the ordinary Google Drive submenu has Connect, Open folder, Save current notebook, Save current datafile, Disconnect. Open folder opens notebooks directly and supported UTF-8 text datafiles as editable local copies linked to Drive for the current authorization session. Save current datafile explicitly uploads the live text; normal Ctrl+S saves only the local copy. Binary data stays available via the advanced mount/import/export workflow. The 5 MiB data limit and version checks remain in force.
