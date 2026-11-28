# Real-account acceptance checklist (experimental)

Use only disposable notebooks and non-sensitive data. CI uses actual JupyterLite and Pyodide but simulated Google services. Do not treat successful CI as real-account acceptance.

## Preparation

- Open https://lmari.github.io/jupyterlite-google-drive/lab/index.html in a current desktop Chromium or Firefox browser; confirm the latest deployment succeeded in Actions. Use two independent browser profiles or two computers. Do not clear browser storage containing needed local notebooks.
- Configure Google Cloud following [Google Cloud setup](../README.md#google-cloud-setup). Add the testing account to the OAuth test-user list. Do not share credentials or tokens in bug reports.
- Upload a disposable CSV named dati.csv with three lines: x,y then 2,3 then 4,5. Use the same account on both devices.

## Notebook and input workflow

1. Connect in the Drive sidebar. Create a local Python notebook; type and execute `6*7`; choose Save notebook as new Drive copy. Check that the .ipynb appears in My Drive.
2. Refresh the authorized notebook list. Open that disposable notebook natively. Mount dati.csv using Google Picker. Add selected dependency, choosing /drive/data/dati.csv.
3. Execute:

   ```python
   import csv
   with open('/drive/data/dati.csv') as f:
       rows = list(csv.DictReader(f))
   sum(int(r['x']) for r in rows)
   ```

   Expected: 6. If /drive is unavailable, record browser/OS and try the temporary import fallback; do not mark native filesystem acceptance passed.
4. Save (Ctrl+S); check the sidebar acknowledges the save. Change the cell and wait for autosave (normally about two minutes). Verify the updated code and output on the second device by reopening the remote notebook. Restore notebook data dependencies; run the input cell again. Expected 6.
5. On one device change the CSV in Drive without changing its ID. Reopen the data from Python; expect the new values. The dependency is a live reference, not a pinned dataset.

## Output and recovery

6. Write a file using Python:

   ```python
   from pathlib import Path
   Path('/drive/output/risultati.csv').write_text('sum\n6\n', encoding='utf-8')
   ```

   Export output to Drive, confirm and verify a NEW file with the exact contents in My Drive. Download output locally and verify the same bytes.
7. With two editors on the same initial notebook version, save an edit from one, then try saving a different edit from the other. The stale editor must not overwrite the newer remote file. Verify local recovery copy and Download notebook recovery file retain the stale editor's unsaved changes. This is best-effort conflict detection, not a distributed lock.
8. With a native notebook and staged output open, choose Renew authorization and the same Google account. Verify the notebook stays open, data still read and Ctrl+S works. If another test account is available, choose it for renewal and verify rejection without losing work. Switching accounts is a separate operation requiring closed native editors.
9. Disconnect the network temporarily after opening the notebook; edit and attempt Save. Verify failure is visible and local recovery/download work. Restore the network and explicitly retry or save a new copy. Download staged output before reload. Browser leave warnings are best effort only.

## Record results

Record browser/version, OS, deployment commit, date, step number, actual result, and sanitized error. Mark pass/fail/not tested separately for each step. Never paste access tokens, private file IDs or sensitive notebook data. Test mobile separately if intended for classroom use. On a physical tablet, use touch only to open File, open and activate both Drive submenus, open the native New submenu, and execute a command. Verify notebook editing and saving with the toolbar as well as local recovery. Record results for each browser; desktop touch emulation is not a substitute.

## Release gate

Before a stable release: run CI, pass real-account read/write and recovery on supported browsers, confirm OAuth deployment settings, document limits (shared mount namespace, volatile output, size limits, no atomic conflict protection), and prepare installation/distribution instructions. No claim of production readiness from mocked tests alone.
