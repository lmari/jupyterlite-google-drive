"""Build the prebuilt extension wheel from an already compiled labextension.

This packages browser assets only, without Google config or a backend.
The wheel belongs in the site builder's Python environment, not Pyodide.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from packaging.version import Version
from packaging.utils import parse_wheel_filename

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"wheel-dist"
NAME="jupyterlite-google-drive"
PREFIX="share/jupyter/labextensions/"+NAME+"/"

def main():
    source=json.loads((ROOT/"package.json").read_text())
    built=json.loads((ROOT/"labextension/package.json").read_text())
    assert built["version"]==source["version"], "Stale build"
    entry=built["jupyterlab"]["_build"]["load"]
    assert (ROOT/"labextension"/entry).is_file()
    if OUT.exists():
        shutil.rmtree(OUT)
    subprocess.run([sys.executable,"-m","build","--wheel","--outdir",str(OUT)],cwd=ROOT,check=True)
    wheels=list(OUT.glob("*.whl"))
    assert len(wheels)==1
    _,version,_,_=parse_wheel_filename(wheels[0].name)
    assert version==Version(source["version"]), "Python and JS versions differ"
    with zipfile.ZipFile(wheels[0]) as z:
        names=z.namelist()
        assert any(p.endswith(PREFIX+"package.json") for p in names)
        assert any(p.endswith(PREFIX+entry) for p in names)
        assert not any("jupyter-lite.json" in p or "node_modules/" in p or p.endswith(".env") for p in names)
    print("Prebuilt wheel verified:", wheels[0].name)

if __name__=="__main__":
    main()
