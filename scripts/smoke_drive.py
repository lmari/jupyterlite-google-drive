"""Browser integration test against a simulated Google account/Drive.

The application bundle is real; Google Identity Services, Picker and REST
responses are fake. No external Google account, OAuth credentials or data.
"""
import json
from email import policy
from email.parser import BytesParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlparse, parse_qs
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
MOCK_GOOGLE = """
(() => {
  class Builder {
    addView() { return this; }
    setOAuthToken(t) { if (t !== 'mock-token') throw Error('Wrong token'); return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setOrigin() { return this; }
    setCallback(cb) { this.cb = cb; return this; }
    build() { return {setVisible: () => this.cb({action:'picked',docs:[{id:window.__drivePickId || 'demo-file'}]})}; }
  }
  window.google = {
    accounts: {oauth2: {
      initTokenClient: opts => ({
        requestAccessToken: () => opts.callback({access_token:'mock-token',expires_in:3600})
      }),
      hasGrantedAllScopes: () => true,
      revoke: (token, cb) => cb({})
    }},
    picker: {
      PickerBuilder: Builder, DocsView: class {}, ViewId:{DOCS:'docs'},
      Response:{ACTION:'action',DOCUMENTS:'docs'}, Document:{ID:'id'},
      Action:{PICKED:'picked',CANCEL:'cancel',ERROR:'error'}
    }
  };
  window.gapi = {load: (name, opts) => opts.callback()};
})();
"""

class FakeDrive:
    def __init__(self):
        self.version = 1
        self.notebook = json.loads((ROOT / "demo/notebooks/welcome.ipynb").read_text())
        self.notebook["cells"][1]["source"] = ["40 + 2"]
        self.writes = 0
        self.created_data = []
        self.hold_next_write = False
        self.pending_write = None
        self.unavailable = False
        self.csv_data = "x,y\n2,3\n4,5\n"

    def metadata(self):
        return {"id":"demo-file", "name":"remote.ipynb", "version":str(self.version),
                "trashed":False, "mimeType":"application/json", "capabilities":{"canEdit":True}}

    def handle(self, route):
        req = route.request
        url = urlparse(req.url)
        cors = {"access-control-allow-origin":"*", "access-control-allow-headers":"authorization,content-type",
                "access-control-allow-methods":"GET,PATCH,POST,OPTIONS"}
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers=cors)
            return
        assert req.headers.get("authorization") == "Bearer mock-token"
        if self.unavailable:
            route.fulfill(status=503, headers=cors, json={"error":"simulated outage"})
            return
        if url.path == "/drive/v3/files/data-file" and req.method == "GET":
            if parse_qs(url.query).get("alt") == ["media"]:
                route.fulfill(status=200, headers=cors, content_type="text/csv", body=self.csv_data)
                return
            value = {"id":"data-file","name":"dati.csv","version":"1","mimeType":"text/csv","size":"12","trashed":False}
        elif url.path == "/drive/v3/files" and req.method == "GET":
            value = {"files":[self.metadata(), {"id":"other","name":"ignore.csv"}]}
        elif url.path == "/drive/v3/files/demo-file" and req.method == "GET":
            value = self.notebook if parse_qs(url.query).get("alt") == ["media"] else self.metadata()
        elif url.path == "/upload/drive/v3/files" and req.method == "POST":
            header = ("Content-Type: " + req.headers["content-type"] + "\r\nMIME-Version: 1.0\r\n\r\n").encode()
            parts = list(BytesParser(policy=policy.default).parsebytes(header + req.post_data_buffer).iter_parts())
            assert len(parts) == 2
            metadata = json.loads(parts[0].get_payload(decode=True))
            data_bytes = parts[1].get_payload(decode=True)
            self.created_data.append((metadata["name"], data_bytes))
            value = {"id":"new-data-" + str(len(self.created_data)), "name":metadata["name"], "version":"1"}
        elif url.path == "/upload/drive/v3/files/demo-file" and req.method == "PATCH":
            if self.hold_next_write:
                self.hold_next_write = False
                self.pending_write = route
                return
            self.notebook = json.loads(req.post_data)
            self.version += 1
            self.writes += 1
            value = self.metadata()
        else:
            route.fulfill(status=404, headers=cors, json={"error":"unexpected request"})
            return
        route.fulfill(status=200, headers=cors, json=value)

    def finish_pending_write(self):
        route = self.pending_write
        assert route is not None
        self.pending_write = None
        self.notebook = json.loads(route.request.post_data)
        self.version += 1
        self.writes += 1
        route.fulfill(status=200, headers={"access-control-allow-origin":"*"}, json=self.metadata())

def wait_for(page, predicate, message, seconds=30):
    # Pump browser events while waiting for asynchronous writes.
    for _ in range(seconds * 5):
        if predicate():
            return
        page.wait_for_timeout(200)
    assert predicate(), message

def source(drive):
    return "".join(drive.notebook["cells"][1]["source"]).strip()

def edit_cell(page, cell, text):
    cell.click()
    page.keyboard.press("Control+a")
    page.keyboard.insert_text(text)
    expect(cell).to_have_text(text)

def command(page, label):
    page.locator(".lm-MenuBar-item").filter(has_text="File").first.click()
    page.get_by_text("Google Drive: " + label, exact=True).click()

def dialog(page, message):
    # Match the expected dialog, not a moving .last locator: the next
    # dialog may already be visible when the previous one is dismissed.
    modal = page.locator(".jp-Dialog").filter(has_text=message)
    expect(modal).to_have_count(1, timeout=30000)
    expect(modal).to_be_visible()
    modal.locator(".jp-Dialog-button.jp-mod-accept").click()
    expect(modal).to_be_hidden()

def open_remote(page):
    command(page, "Open notebook")
    dialog(page, "Opened remote.ipynb")
    cell = page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
    expect(cell).to_be_visible(timeout=30000)
    return cell

def browse_remote(page):
    command(page, "Browse authorized notebooks")
    modal = page.locator(".jp-Dialog").filter(has_text="Authorized Google Drive notebooks")
    expect(modal).to_have_count(1, timeout=30000)
    expect(modal).to_be_visible()
    expect(modal.locator("select option")).to_have_count(1)
    expect(modal.locator("select option").first).to_contain_text("remote.ipynb")
    modal.locator(".jp-Dialog-button.jp-mod-accept").click()
    dialog(page, "Opened remote.ipynb")
    cell = page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
    expect(cell).to_be_visible(timeout=30000)
    return cell

def start(browser, url, drive, service_workers="block"):
    context = browser.new_context(service_workers=service_workers)
    context.add_init_script(MOCK_GOOGLE)
    context.route("https://www.googleapis.com/**", drive.handle)
    context.route("https://accounts.google.com/**", lambda route: route.abort())
    context.route("https://apis.google.com/**", lambda route: route.abort())
    page = context.new_page()
    page.on("pageerror", lambda error: print("Browser error:", error))
    page.on("console", lambda msg: print("Filesystem:", msg.text) if "synced with Jupyter Contents" in msg.text else None)
    page.goto(url, wait_until="domcontentloaded", timeout=120000)
    expect(page.locator(".jp-Notebook:visible").first).to_be_visible(timeout=120000)
    command(page, "Connect")
    dialog(page, "Connected.")
    return context, page

def main():
    fake = FakeDrive()
    with TemporaryDirectory() as temp:
        site = Path(temp) / "jupyterlite-google-drive"
        shutil.copytree(ROOT / "dist", site)
        # Test-only configuration in a temporary copy, never in the published site.
        config = site / "jupyter-lite.json"
        data = json.loads(config.read_text())
        data.setdefault("jupyter-config-data", {}).update({
            "googleDriveClientId":"mock-client", "googleDriveApiKey":"mock-key",
            "googleDriveAppId":"123456789"
        })
        config.write_text(json.dumps(data))
        with ThreadingHTTPServer(("127.0.0.1",0), partial(SimpleHTTPRequestHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url = f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    browser = pw.chromium.launch()
                    a = b = None
                    try:
                        ctx_a, a = start(browser, url, fake)
                        cell_a = open_remote(a)
                        expect(cell_a).to_have_text("40 + 2")
                        ctx_b, b = start(browser, url, fake)
                        cell_b = open_remote(b)
                        expect(cell_b).to_have_text("40 + 2")

                        # Edit through the real CodeMirror editor and save from A.
                        cell_a.click()
                        a.keyboard.press("Control+a")
                        a.keyboard.insert_text("6 * 7")
                        expect(cell_a).to_have_text("6 * 7")
                        command(a, "Save to original")
                        dialog(a, "Overwrite remote.ipynb")
                        dialog(a, "Saved remote.ipynb")
                        assert fake.writes == 1
                        assert "".join(fake.notebook["cells"][1]["source"]).strip() == "6 * 7"

                        # B still has the old version; it must not overwrite A.
                        cell_b.click()
                        command(b, "Save to original")
                        dialog(b, "Overwrite remote.ipynb")
                        dialog(b, "Remote file changed")
                        assert fake.writes == 1

                        # Reopen from simulated Drive on the other browser.
                        cell_b = browse_remote(b)
                        expect(cell_b).to_have_text("6 * 7")
                        # Experimental native mount uses the real JupyterLab
                        # document manager and standard Save, not the import command.
                        command(a, "Open native notebook (experimental)")
                        dialog(a, "Experimental remote editor")
                        dialog(a, "Opened native notebook")
                        cell = a.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        expect(cell).to_have_text("6 * 7")
                        cell.click()
                        a.keyboard.press("Control+a")
                        a.keyboard.insert_text("7 * 8")
                        expect(cell).to_have_text("7 * 8")
                        a.keyboard.press("Control+s")
                        for _ in range(100):
                            if fake.writes >= 2:
                                break
                            a.wait_for_timeout(200)
                        assert fake.writes >= 2, "Native save did not reach Drive"
                        assert "".join(fake.notebook["cells"][1]["source"]).strip() == "7 * 8"
                        print("Native Ctrl+S persisted the code cell.")
                        # Exercise the real Pyodide kernel, not just the editor.
                        cell.click()
                        a.keyboard.press("Control+Enter")
                        output = a.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first
                        expect(output).to_have_text("56", timeout=180000)
                        a.keyboard.press("Control+s")
                        for _ in range(150):
                            outputs = fake.notebook["cells"][1].get("outputs", [])
                            if any("56" == "".join(o.get("data", {}).get("text/plain", [])).strip() for o in outputs):
                                break
                            a.wait_for_timeout(200)
                        else:
                            raise AssertionError("Executed Python output did not persist on simulated Drive")

                        print("Pyodide executed the native notebook and its output persisted.")
                        # Transfer a CSV through the live notebook kernel, not via
                        # service worker synchronization or an OAuth token in Python.
                        a.wait_for_timeout(1000)
                        a.evaluate("window.__drivePickId = 'data-file'")
                        command(a, "Import data into Python")
                        dialog(a, "Import data into Python?")
                        dialog(a, "Data available in Python at /tmp/jupyterlite-drive/dati.csv")
                        # Change remote data to prove the collision leaves original bytes untouched.
                        fake.csv_data = "x,y\n10,3\n40,5\n"
                        command(a, "Import data into Python")
                        dialog(a, "Import data into Python?")
                        dialog(a, "temporary file with this name already exists")
                        a.evaluate("window.__drivePickId = 'demo-file'")
                        edit_cell(a, cell, 'import csv; sum(int(r["x"]) for r in csv.DictReader(open("/tmp/jupyterlite-drive/dati.csv")))')
                        a.keyboard.press("Control+Enter")
                        expect(output).to_have_text("6", timeout=60000)
                        print("Imported Drive CSV was read by real Python in the native notebook.")

                        # Delay the next upload while the user continues editing.
                        # The completed upload must contain the captured snapshot,
                        # and the later edit must stay dirty for JupyterLab autosave.
                        # Allow the preceding save's metadata/checkpoint to settle.
                        a.wait_for_timeout(1000)
                        fake.hold_next_write = True
                        edit_cell(a, cell, "8 * 8")
                        a.keyboard.press("Control+s")
                        wait_for(a, lambda: fake.pending_write is not None,
                                 "Manual save did not start")
                        edit_cell(a, cell, "9 * 8")
                        fake.finish_pending_write()
                        assert source(fake) == "8 * 8"
                        expect(cell).to_have_text("9 * 8")
                        writes_before_auto = fake.writes
                        # No Ctrl+S here. Exercise the real configured JupyterLab
                        # autosave timer (normally 120 s), not a direct API call.
                        wait_for(a, lambda: source(fake) == "9 * 8",
                                 "Autosave did not persist the edit made during upload", seconds=180)
                        assert fake.writes > writes_before_auto
                        print("Native autosave preserved and persisted an edit made during a pending save.")
                        a.wait_for_timeout(1000)
                        # Independent browser reopens the automatically saved version.
                        cell_b = browse_remote(b)
                        expect(cell_b).to_have_text("9 * 8")
                        # Simulate a remote modification and an unsaved local edit.
                        fake.version += 1
                        cell.click()
                        a.keyboard.press("Control+a")
                        a.keyboard.insert_text("9 * 9")
                        a.keyboard.press("Control+s")
                        # JupyterLab's built-in error dialog has a Close (cancel)
                        # button, unlike our own OK/accept dialogs.
                        modal = a.locator(".jp-Dialog").filter(has_text="Remote file changed")
                        expect(modal).to_have_count(1, timeout=30000)
                        expect(modal).to_be_visible()
                        modal.get_by_role("button", name="Close", exact=True).click()
                        expect(modal).to_be_hidden()
                        assert source(fake) == "9 * 8"
                        # Recovery copies live editor contents to the default local drive.
                        fake.unavailable = True
                        cell.click()
                        command(a, "Save local recovery copy")
                        dialog(a, "Local recovery copy saved")
                        recovered = a.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        expect(recovered).to_have_text("9 * 9")
                        assert source(fake) == "9 * 8"
                        fake.unavailable = False
                        print("Local recovery preserved unsaved edits during a simulated Drive outage.")
                        ctx_a.close()
                        ctx_b.close()
                        print("Mocked Drive round trip and stale-write rejection passed.")
                    except Exception:
                        for name, page in (("a",a),("b",b)):
                            if page and not page.is_closed():
                                page.screenshot(path=str(ROOT / f"drive-failure-{name}.png"),full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__ == "__main__":
    main()
