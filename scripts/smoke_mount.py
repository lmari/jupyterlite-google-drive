"""Browser test of the actual DriveFS bridge with cross-origin isolation.

The ordinary smoke test deliberately blocks service workers without isolation.
This test also blocks them, but serves COOP/COEP headers so Pyodide uses its
SharedArrayBuffer transport to the actual ContentsManager.
"""
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright, expect
from smoke_drive import FakeDrive, start, command, dialog, edit_cell, wait_for

ROOT = Path(__file__).resolve().parents[1]

class IsolatedHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--transport",choices=["shared-memory","service-worker"],default="shared-memory")
    args=parser.parse_args()
    service_worker=args.transport=="service-worker"
    fake=FakeDrive()
    with TemporaryDirectory() as temp:
        site=Path(temp)/"jupyterlite-google-drive"
        shutil.copytree(ROOT/"dist",site)
        config=site/"jupyter-lite.json"
        data=json.loads(config.read_text())
        data.setdefault("jupyter-config-data",{}).update({
            "googleDriveClientId":"mock-client","googleDriveApiKey":"mock-key","googleDriveAppId":"123456789"})
        config.write_text(json.dumps(data))
        with ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler if service_worker else IsolatedHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url=f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    browser=pw.chromium.launch()
                    page=None
                    try:
                        ctx,page=start(browser,url,fake,service_workers="allow" if service_worker else "block")
                        assert page.evaluate("crossOriginIsolated") == (not service_worker), "Unexpected cross-origin isolation status"
                        if service_worker:
                            # Registration alone is insufficient: the page must be controlled.
                            page.wait_for_function("navigator.serviceWorker.controller !== null",timeout=60000)
                        print("Testing DriveFS transport:",args.transport)
                        command(page,"Open folder")
                        workspace=page.locator("#jupyterlite-google-drive-sidebar")
                        expect(workspace.get_by_role("status")).to_have_text("Authorized")
                        workspace.get_by_role("button",name="Refresh folder").click()
                        expect(workspace.get_by_role("button",name="Open remote.ipynb",exact=True)).to_be_enabled(timeout=30000)
                        workspace.get_by_role("button",name="Open remote.ipynb",exact=True).click()
                        dialog(page,"Experimental remote editor")
                        dialog(page,"Opened native notebook")
                        cell=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        expect(cell).to_have_text("40 + 2")
                        page.evaluate("window.__drivePickId = 'data-file'")
                        command(page,"Mount read-only data file (experimental)")
                        dialog(page,"Mount read-only data?")
                        dialog(page,"Mounted /drive/data/dati.csv")
                        expect(workspace.get_by_text("/drive/data/dati.csv",exact=True)).to_be_visible()
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
                        # Python writes bytes to the temporary staging directory.
                        # No cloud upload occurs until explicit confirmation.
                        edit_cell(page,cell,'from pathlib import Path; Path("/drive/output/result.bin").write_bytes(bytes([0,255,128,65]))')
                        page.keyboard.press("Control+Enter")
                        expect(output).to_have_text("4",timeout=60000)
                        assert fake.created_data == []
                        expect(workspace.get_by_text("/drive/output/result.bin",exact=True)).to_be_visible()
                        edit_cell(page,cell,'list(Path("/drive/output/result.bin").read_bytes())')
                        page.keyboard.press("Control+Enter")
                        expect(output).to_have_text("[0, 255, 128, 65]",timeout=60000)
                        command(page,"Export Python output as new file")
                        modal=page.locator(".jp-Dialog").filter(has_text="Choose Python output")
                        expect(modal.locator("select option")).to_have_count(1)
                        expect(modal.locator("select option").first).to_have_text("output/result.bin")
                        modal.locator(".jp-Dialog-button.jp-mod-accept").click()
                        dialog(page,"Create new file on Google Drive?")
                        dialog(page,"Created result.bin in JupyterLite")
                        assert fake.created_data == [("result.bin",bytes([0,255,128,65]))]
                        assert fake.writes == 0
                        print("Python output exported as a new binary file, without overwriting Drive data.")
                        # Expired token, wrong account, then same-account renewal.
                        fake.expire_original_token=True
                        workspace.get_by_role("button",name="Refresh folder").click()
                        dialog(page,"Drive request failed (401)")
                        expect(workspace.get_by_role("status")).to_have_text("Authorization expired")
                        assert page.evaluate("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))")
                        with page.expect_download() as downloaded:
                            command(page,"Download Python output locally")
                            dialog(page,"Download Python output?")
                        recovery=downloaded.value
                        assert recovery.suggested_filename=="result.bin"
                        assert recovery.path().read_bytes()==bytes([0,255,128,65])
                        assert fake.created_data == [("result.bin",bytes([0,255,128,65]))]
                        print("Downloaded exact staged output bytes while authorization expired.")
                        page.evaluate("window.__driveAuthToken = 'other-token'")
                        command(page,"Renew authorization")
                        dialog(page,"Different Google account selected")
                        expect(workspace.get_by_role("status")).to_have_text("Authorization expired")
                        expect(cell).to_have_text('list(Path("/drive/output/result.bin").read_bytes())')
                        page.evaluate("window.__driveAuthToken = 'renewed-token'")
                        command(page,"Renew authorization")
                        dialog(page,"Authorization renewed.")
                        expect(workspace.get_by_role("status")).to_have_text("Authorized")
                        expect(workspace.get_by_text("/drive/data/dati.csv",exact=True)).to_be_visible()
                        expect(workspace.get_by_text("/drive/output/result.bin",exact=True)).to_be_visible()
                        edit_cell(page,cell,'sum(int(r["x"]) for r in csv.DictReader(open("/drive/data/dati.csv")))')
                        page.keyboard.press("Control+Enter")
                        expect(output).to_have_text("50",timeout=60000)
                        # Two data files are mounted, but the notebook records only one.
                        page.evaluate("window.__drivePickId = 'other-data'")
                        command(page,"Mount read-only data file (experimental)")
                        dialog(page,"Mount read-only data?")
                        dialog(page,"Mounted /drive/data/other.csv")
                        expect(workspace.get_by_text("/drive/data/other.csv",exact=True)).to_be_visible()
                        command(page,"Add selected data dependency")
                        choice=page.locator(".jp-Dialog").filter(has_text="Add data dependency?")
                        expect(choice.locator("select option")).to_have_count(2)
                        choice.locator("select").select_option(label="/drive/data/dati.csv")
                        dialog(page,"Add data dependency?")
                        dialog(page,"Dependency added.")
                        expect(workspace.get_by_text("Recorded: /drive/data/dati.csv",exact=True)).to_be_visible()
                        expect(workspace.get_by_text("Recorded: /drive/data/other.csv",exact=True)).to_have_count(0)
                        command(page,"Add selected data dependency")
                        dialog(page,"Add data dependency?")
                        dialog(page,"Dependency added.")
                        expect(workspace.get_by_text("Recorded: /drive/data/other.csv",exact=True)).to_be_visible()
                        command(page,"Remove recorded data dependency")
                        choice=page.locator(".jp-Dialog").filter(has_text="Remove recorded dependency?")
                        choice.locator("select").select_option(label="/drive/data/other.csv")
                        dialog(page,"Remove recorded dependency?")
                        dialog(page,"Dependency removed from notebook metadata.")
                        expect(workspace.get_by_text("Recorded: /drive/data/other.csv",exact=True)).to_have_count(0)
                        expect(workspace.get_by_text("/drive/data/other.csv",exact=True)).to_be_visible()
                        expect(workspace.get_by_text("Recorded: /drive/data/dati.csv",exact=True)).to_be_visible()
                        # Removal affects only notebook metadata, never mounts or Drive.
                        print("Selective dependency recording and removal preserved both mounted files.")
                        page.keyboard.press("Control+s")
                        wait_for(page,lambda:fake.writes>0,"Save after renewal did not reach Drive")
                        assert fake.notebook["metadata"]["jupyterlite_google_drive"] == {
                            "version":1,"dependencies":[{"path":"data/dati.csv","file_id":"data-file"}]}
                        expect(workspace.locator("[data-save-state]")).to_have_attribute("data-save-state","saved",timeout=30000)
                        print("Same-account authorization renewed with notebook and data preserved; wrong account rejected.")
                        ctx.close()
                        # Independent browser context, no mounted state from the first.
                        fake.expire_original_token=False
                        ctx,page=start(browser,url,fake,service_workers="allow" if service_worker else "block")
                        if service_worker:
                            page.wait_for_function("navigator.serviceWorker.controller !== null",timeout=60000)
                        command(page,"Open native notebook (experimental)")
                        dialog(page,"Experimental remote editor")
                        dialog(page,"Opened native notebook")
                        command(page,"Open folder")
                        workspace=page.locator("#jupyterlite-google-drive-sidebar")
                        expect(workspace.get_by_text("Recorded: /drive/data/dati.csv",exact=True)).to_be_visible()
                        expect(workspace.locator("[data-dependency-state]")).to_have_attribute("data-dependency-state","not-mounted")
                        expect(workspace.get_by_text("No mounted data.",exact=True)).to_be_visible()
                        command(page,"Restore notebook data dependencies")
                        dialog(page,"Restore notebook data dependencies?")
                        dialog(page,"Restored notebook data dependencies:")
                        expect(workspace.get_by_text("/drive/data/dati.csv",exact=True)).to_be_visible()
                        cell=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        edit_cell(page,cell,'import csv; sum(int(r["x"]) for r in csv.DictReader(open("/drive/data/dati.csv")))')
                        page.keyboard.press("Control+Enter")
                        output=page.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first
                        expect(output).to_have_text("50",timeout=180000)
                        expect(workspace.locator("[data-dependency-state]")).to_have_attribute("data-dependency-state","mounted")
                        expect(workspace.get_by_text("/drive/data/other.csv",exact=True)).to_have_count(0)
                        print("Fresh browser restored only the selected notebook data dependency and executed Python.")
                        ctx.close()
                    except Exception:
                        if page and not page.is_closed():
                            page.screenshot(path=str(ROOT/("mount-failure-"+args.transport+".png")),full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__=="__main__":
    main()
