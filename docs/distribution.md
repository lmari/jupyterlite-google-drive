# Install the prebuilt extension

Experimental beta candidate, not approved for production or classroom deployment. The package is a JupyterLab federated frontend extension for JupyterLite 0.9.0b2 / JupyterLab 4.7.0b2 / Pyodide kernel 0.9.0b0 (automated tests passed; real-account acceptance pending). It has no server extension. Compatibility outside this tested combination is not established.

## Install and build

After a successful CI run, download the `jupyterlite-google-drive-wheel` artifact from GitHub Actions, extract the ZIP, and install the .whl in a fresh Python virtual environment (Python 3.11 or later):

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install jupyterlite-core==0.9.0b2 jupyterlite-pyodide-kernel==0.9.0b0
python -m pip install ./jupyterlite_google_drive-0.6.0b4-py3-none-any.whl
```

On Windows activate with `.venv\Scripts\activate`. The actual wheel filename follows the version in the artifact. You do not need Node.js or npm to install a prebuilt wheel. Do not use `%pip install` in a running notebook: installation is a site-build operation.

Create a site directory with `jupyter-lite.json` using the settings below (all values are public client configuration, never a secret):

```json
{
  "jupyter-config-data": {
    "googleDriveClientId": "YOUR_WEB_CLIENT_ID",
    "googleDriveApiKey": "YOUR_RESTRICTED_API_KEY",
    "googleDriveAppId": "YOUR_NUMERIC_PROJECT_NUMBER"
  }
}
```

Follow [Google Cloud setup](../README.md#google-cloud-setup) for your own OAuth client and origin. Run from that directory:

```sh
jupyter lite build --output-dir dist
python -m http.server 8000 --directory dist
```

Open http://localhost:8000/lab/index.html. Deploy dist to HTTPS static hosting after testing. The extension is discovered under share/jupyter/labextensions in the build environment. OAuth settings are not bundled in the wheel; no client secret is needed.

## Build the wheel from source

Install the repository build dependencies and Node 22, then:

```sh
python -m pip install -r requirements-build.txt build
npm install
npm run build
python scripts/package_wheel.py
python scripts/smoke_wheel.py
```

The wheel packaging script checks the JS/Python version agreement and federation entry, and rejects bundled runtime site config. CI installs the wheel in a separate virtual environment, builds another static site without a source-extension path, and checks browser activation. No automatic PyPI or npm publishing. Before distributing to a class, complete the [real-account acceptance checklist](acceptance.md).
