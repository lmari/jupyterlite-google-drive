"""Build the extension and static demo; no Google credentials required."""
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
DIST = ROOT / "dist"
EXT = ROOT / "labextension"
EXTRA = ROOT / ".extra-labextensions"
NAME = "jupyterlite-google-drive"

def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)

def main():
    run("npm", "run", "build")
    package = json.loads((EXT / "package.json").read_text())
    remote = package["jupyterlab"]["_build"]["load"]
    assert (EXT / remote).is_file(), "Missing federation entry"
    target = EXTRA / NAME
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(EXT, target)
    if DIST.exists():
        shutil.rmtree(DIST)
    run("jupyter", "lite", "build", "--lite-dir", str(DEMO),
        "--contents", str(DEMO / "notebooks"), "--output-dir", str(DIST),
        "--FederatedExtensionAddon.extra_labextensions_path=" + str(EXTRA))
    # Public OAuth configuration is injected into the deployed runtime file,
    # never into git. Preserve all generated JupyterLite configuration.
    keys = {"googleDriveClientId": "GOOGLE_DRIVE_CLIENT_ID",
            "googleDriveApiKey": "GOOGLE_DRIVE_API_KEY",
            "googleDriveAppId": "GOOGLE_DRIVE_APP_ID"}
    values = {key: os.environ.get(env, "").strip() for key, env in keys.items()}
    if any(values.values()) and not all(values.values()):
        raise RuntimeError("Set all three Google Drive configuration variables or none.")
    config = DIST / "jupyter-lite.json"
    data = json.loads(config.read_text())
    if all(values.values()):
        data.setdefault("jupyter-config-data", {}).update(values)
        config.write_text(json.dumps(data, indent=2) + "\n")
    assert (DIST / "lab" / "index.html").is_file()
    assert (DIST / "extensions" / NAME / remote).is_file(), "Extension not included in site"
    assert (DIST / "files" / "welcome.ipynb").is_file(), "Demo notebook not included"
    print("Static demo verified:", DIST)

if __name__ == "__main__":
    main()
