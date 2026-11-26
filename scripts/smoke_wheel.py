"""Verify wheel installation and extension discovery in a separate site build."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import venv

ROOT=Path(__file__).resolve().parents[1]
NAME="jupyterlite-google-drive"

def main():
    wheel,=list((ROOT/"wheel-dist").glob("*.whl"))
    # Reuse CI's pinned builder dependencies, but install the extension only
    # inside a separate virtual environment. No source extension path passed.
    with TemporaryDirectory() as temp:
        temp=Path(temp)
        env=temp/"env"
        venv.EnvBuilder(with_pip=True,system_site_packages=True).create(env)
        python=env/"bin/python" if sys.platform!="win32" else env/"Scripts/python.exe"
        subprocess.run([str(python),"-m","pip","install","--no-deps",str(wheel)],check=True)
        extension=env/"share/jupyter/labextensions"/NAME
        assert (extension/"package.json").is_file()
        source=json.loads((extension/"package.json").read_text())
        entry=source["jupyterlab"]["_build"]["load"]
        assert (extension/entry).is_file()
        # Run the actual CLI from the wheel's environment without extra paths.
        demo=temp/"demo"
        demo.mkdir()
        (demo/"jupyter-lite.json").write_text(json.dumps({"jupyter-config-data":{}}))
        out=ROOT/"wheel-demo"
        subprocess.run([str(python),"-m","jupyterlite_core","build","--lite-dir",str(demo),"--contents",str(ROOT/"demo/notebooks"),"--output-dir",str(out)],cwd=demo,check=True)
        assert (out/"extensions"/NAME/entry).is_file()
        assert (out/"files/welcome.ipynb").is_file()
        print("Installed wheel discovered by independent JupyterLite build.")

if __name__=="__main__":
    main()
