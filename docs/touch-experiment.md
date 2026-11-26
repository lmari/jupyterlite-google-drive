# Touch runtime experiment

Do not deploy or merge until the comparison is reviewed and a real tablet is tested.

The existing 0.6.0-beta.2 site uses JupyterLite 0.8.7, JupyterLab 4.6.6 and Lumino Widgets 2.8.0. Lumino [PR 834](https://github.com/jupyterlab/lumino/pull/834) addresses touch menu activation and follow-up click dismissal. The candidate uses JupyterLite 0.9.0b2, JupyterLab 4.7.0b2, Pyodide kernel 0.9.0b0 and Lumino Widgets 2.10.0, matching the upstream [lockfile](https://github.com/jupyterlite/jupyterlite/blob/v0.9.0b2/yarn.lock). Python 3.11+ is required for these dependencies.

The comparison workflow runs the same touch script in independent builds of the known deployed baseline (commit 3ba8723bf5ce5e81a468cb48d204f8e9bdcc9e9f) and the candidate. It tests Chromium and Firefox with touch enabled, waits for the follow-up click, opens both Google Drive submenus, executes actual commands including a local notebook download, and tests a native JupyterLab New > Text File submenu. It records per-browser outcomes and diagnostic screenshots. A baseline failure is recorded but not treated as a candidate failure. A passing baseline means the reported defect has not been reproduced under this simulation; a passing candidate alone then does not demonstrate a fix.

The normal CI workflow separately checks the candidate's existing notebook, DriveFS, dependency, recovery and installable wheel regression suite. No Google credentials are configured. Neither workflow deploys a pull request. Automated desktop engines are not a physical Android browser. A subsequent real-device acceptance check is required, especially on Android Firefox and Chrome, before switching the production site.
