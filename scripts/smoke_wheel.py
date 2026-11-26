"""Verify wheel installation and extension discovery in a separate site build."""
import json
from pathlib import Path
import subprocess
import sys
import shutil
from tempfile import TemporaryDirectory
import venv

ROOT=Path(__file__).resolve().parents[1]
NAME="jupyterlite-google-drive"

def main():
    wheel,=list((ROOT/"wheel-dist").glob("*.whl"))
    # Use an isolated environment: inherited site-packages do not imply
    # inherited share/jupyter/labextensions data (e.g. Pyodide).
    with TemporaryDirectory() as temp:
        temp=Path(temp)
        env=temp/"env"
        venv.EnvBuilder(with_pip=True).create(env)
        python=env/"bin/python" if sys.platform!="win32" else env/"Scripts/python.exe"
        # Install the pinned runtime and wheel into the SAME prefix, so Jupyter
        # discovers both the extension and the Python kernel frontend assets.
        requirements=[line.strip() for line in (ROOT/"requirements-build.txt").read_text().splitlines() if line.startswith(("jupyterlab==","jupyterlite-core==","jupyterlite-pyodide-kernel=="))]
        subprocess.run([str(python),"-m","pip","install",*requirements,str(wheel)],check=True)
        subprocess.run([str(python),"-m","pip","check"],check=True)
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
        if out.exists(): shutil.rmtree(out)
        subprocess.run([str(python),"-m","jupyterlite_core","build","--lite-dir",str(demo),"--contents",str(ROOT/"demo/notebooks"),"--output-dir",str(out)],cwd=demo,check=True)
        assert (out/"extensions"/NAME/entry).is_file()
        kernel=out/"extensions/@jupyterlite/pyodide-kernel-extension"
        kernel_package=json.loads((kernel/"package.json").read_text())
        assert (kernel/kernel_package["jupyterlab"]["_build"]["load"]).is_file(), "Missing installed Python kernel frontend"
        assert (out/"files/welcome.ipynb").is_file()
        print("Installed wheel discovered by independent JupyterLite build.")

if __name__=="__main__":
    main()
