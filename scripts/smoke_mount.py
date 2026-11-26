"""Browser test of the actual DriveFS bridge with cross-origin isolation.

The ordinary smoke test deliberately blocks service workers without isolation.
This test also blocks them, but serves COOP/COEP headers so Pyodide uses its
SharedArrayBuffer transport to the actual ContentsManager.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright, expect
from smoke_drive import FakeDrive, start, command, dialog, edit_cell

ROOT = Path(__file__).resolve().parents[1]

class IsolatedHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

def main():
    fake=FakeDrive()
    with TemporaryDirectory() as temp:
        site=Path(temp)/"jupyterlite-google-drive"
        shutil.copytree(ROOT/"dist",site)
        config=site/"jupyter-lite.json"
        data=json.loads(config.read_text())
        data.setdefault("jupyter-config-data",{}).update({
            "googleDriveClientId":"mock-client","googleDriveApiKey":"mock-key","googleDriveAppId":"123456789"})
        config.write_text(json.dumps(data))
        with ThreadingHTTPServer(("127.0.0.1",0),partial(IsolatedHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url=f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    browser=pw.chromium.launch()
                    page=None
                    try:
                        ctx,page=start(browser,url,fake)
                        assert page.evaluate("crossOriginIsolated"), "SharedArrayBuffer test requires isolation"
                        command(page,"Open native notebook (experimental)")
                        dialog(page,"Experimental remote editor")
                        dialog(page,"Opened native notebook")
                        cell=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        expect(cell).to_have_text("40 + 2")
                        page.evaluate("window.__drivePickId = 'data-file'")
                        command(page,"Mount read-only data file (experimental)")
                        dialog(page,"Mount read-only data?")
                        dialog(page,"Mounted /drive/data/dati.csv")
                        edit_cell(page,cell,'import csv; sum(int(r["x"]) for r in csv.DictReader(open("/drive/data/dati.csv")))')
                        page.keyboard.press("Control+Enter")
                        output=page.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first
                        expect(output).to_have_text("6",timeout=180000)
                        print("Mounted CSV read through actual Pyodide DriveFS.")
                        fake.csv_data="x,y\n10,3\n40,5\n"
                        page.keyboard.press("Control+Enter")
                        expect(output).to_have_text("50",timeout=60000)
                        assert fake.writes==0, "Reading mounted data must not write remotely"
                        print("A second open read fresh remote bytes.")
                        ctx.close()
                    except Exception:
                        if page and not page.is_closed():
                            page.screenshot(path=str(ROOT/"mount-failure.png"),full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__=="__main__":
    main()
