"""Browser smoke test: menu registration and local notebook."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright, expect

def main():
    root = Path(__file__).resolve().parents[1]
    # Emulate project Pages hosting below a path prefix rather than at /.
    with TemporaryDirectory() as temp:
        site = Path(temp) / "jupyterlite-google-drive"
        shutil.copytree(root / "dist", site)
        with ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=temp)) as server:
            Thread(target=server.serve_forever, daemon=True).start()
            url = f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    browser = pw.chromium.launch()
                    page = browser.new_page()
                    page.on("pageerror", lambda error: print("Browser error:", error))
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=120000)
                        expect(page.locator(".jp-Notebook").first).to_be_visible(timeout=120000)
                        page.locator(".lm-MenuBar-item").filter(has_text="File").first.click()
                        for label in ["Connect", "Open notebook", "Browse authorized notebooks", "Open native notebook (experimental)", "Save to original", "Save a new copy", "Save local recovery copy", "Disconnect"]:
                            expect(page.get_by_text("Google Drive: " + label, exact=True)).to_be_visible(timeout=30000)
                        page.keyboard.press("Escape")
                        print("JupyterLite notebook and eight Drive menu commands are visible.")
                    except Exception:
                        page.screenshot(path=str(root / "smoke-failure.png"), full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__ == "__main__":
    main()
