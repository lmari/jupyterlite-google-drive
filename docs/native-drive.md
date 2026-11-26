# Native Drive adapter: next 0.2 increment

The existing import/export path remains a safe fallback. The first 0.2 alpha adds a paginated, fresh list of authorized notebooks in a native JupyterLab selection dialog. It does not expand OAuth permissions.

## Design constraints

- Register a separate Contents.IDrive via the ContentsManager.addDrive API, rather than replacing JupyterLite's BrowserStorageDrive. Preserve the local file browser.
- Provide a dedicated browser for authorized notebooks (not the whole Google Drive tree). Google Drive permits duplicate names; use stable IDs in internal paths and display names separately. Picker remains the mechanism for granting access to additional files.
- Prototype native notebook editing and Ctrl+S with the actual JupyterLite service manager and kernel before exposing the new drive. Verify fileChanged events, document contexts, checkpoints, path normalization, kernel session creation and workspace restoration with real JupyterLite. Do not equate adding a drive to the contents manager with kernel filesystem integration.
- The version associated with a document must reflect the version actually loaded by that editor, not just the latest metadata request. Metadata refresh must never advance a dirty document's save baseline. Queue saves per document, reject stale writes and preserve the dirty editor on failure. Current Drive version checks are best effort and not atomic.
- Start with an explicitly read/write notebook-only adapter; defer rename/delete/folders and Python filesystem access. Do not advertise checkpoints unless implemented. Ensure a usable local recovery/export path during expired authorization, disconnect, errors or network failures.
- Account switches must not silently reuse the preceding account's remote associations. Do not persist tokens. Restored remote paths require authorization again; resolve them only for the current authorized user.
- Enable autosave only after explicit save is verified to keep correct dirty state and safely handle conflicts. Test real Drive and two independent contexts, including duplicate names, token expiry, account switch, and edits during save. Test a real Python cell in the mounted notebook.

References: https://jupyterlab.readthedocs.io/en/stable/api/interfaces/services.Contents.IDrive.html ; https://jupyterlab.readthedocs.io/en/latest/extension/extension_points.html ; https://jupyterlite.readthedocs.io/en/stable/migration.html .

## Experimental branch

The first adapter is a session-scoped, notebook-only mount using unique local paths per remote ID and a fixed loaded version. It registers with the existing contents manager and opens via a separate experimental menu command. No deployment until native save, conflict behavior, autosave and kernel startup are verified. No checkpoints (403), and no rename/delete/create through the mounted drive. The existing import/export workflow remains available.

The recovery command takes a snapshot from the current in-memory editor and saves it to a new local notebook, regardless of authorization or remote availability. The save-state guard uses the adapter's last successfully uploaded snapshot to keep a newer in-memory edit dirty. These protections are under test. Manual recovery is still required; no automatic offline journal exists.
