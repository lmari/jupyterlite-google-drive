# Touch runtime experiment: results

The experiment addressed the loss of touch menu actions and immediate submenu dismissal on tablets, reported during use of the earlier runtime. Lumino [PR 834](https://github.com/jupyterlab/lumino/pull/834) addresses these events.

## Historical comparison

| Runtime | Baseline (0.6.0-beta.2) | Updated (0.6.0-beta.3) |
|---|---|---|
| JupyterLite | 0.8.7 | 0.9.0b2 |
| JupyterLab | 4.6.6 | 4.7.0b2 |
| Pyodide kernel | 0.8.7 | 0.9.0b0 |
| Lumino Widgets | 2.8.0 | 2.10.0 |
| Chromium touch | Failed at ordinary Drive submenu | Passed |
| Firefox touch | Failed at ordinary Drive submenu | Passed |

The same test script was run in independent builds with touch-enabled desktop browser engines, without mouse hover. It reproduced the reported submenu failure on the baseline and passed on the updated runtime, including ordinary and advanced Drive menu activation, recovery download and native JupyterLab New > Text File. See [comparison run 45910895067](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45910895067).

The updated runtime also passed the full regression suite, including both filesystem transports and installation of the wheel into an independent site with real Python execution. It was merged through [PR #15](https://github.com/lmari/jupyterlite-google-drive/pull/15) and [deployed to GitHub Pages](https://github.com/lmari/jupyterlite-google-drive/actions/runs/45911431859).

## Reproduce the test

Build the site using the current repository dependencies, install Playwright's Chromium and Firefox engines, then run:

```sh
python scripts/smoke_touch.py
```

The [comparison workflow](../.github/workflows/touch-comparison.yml) records outcomes and diagnostic screenshots for the historical baseline (commit 3ba8723bf5ce5e81a468cb48d204f8e9bdcc9e9f) and the pull request candidate. A failing historical baseline is expected; a failing candidate must be investigated.

## Remaining acceptance

These automated tests emulate touch in desktop engines, not physical Android or iPad browsers. The updated runtime has been deployed for experimental testing, not certified for tablet classroom use. Verify on physical devices, including Firefox and Chrome on Android if applicable: open File, select both Drive submenus, tap ordinary and advanced commands, and exercise a native JupyterLab submenu. Record browser/OS versions and results in the [acceptance checklist](acceptance.md).
