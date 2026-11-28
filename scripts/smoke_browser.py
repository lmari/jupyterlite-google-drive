"""Browser smoke test: menu registration and local notebook."""
import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright, expect

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--site",default="dist")
    args=parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    # Emulate project Pages hosting below a path prefix rather than at /.
    with TemporaryDirectory() as temp:
        site = Path(temp) / "jupyterlite-google-drive"
        shutil.copytree(root / args.site, site)
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
                        # Lumino submenu items have aria-haspopup, but no
                        # menuitem role. Select the actual visible label.
                        file_menu=page.locator(".lm-Menu:visible").first
                        labels=file_menu.locator(".lm-Menu-itemLabel")
                        expect(labels.filter(has_text=re.compile(r"^Google Drive$"))).to_have_count(1)
                        expect(labels.filter(has_text=re.compile(r"^Google Drive \(advanced\)$"))).to_have_count(1)
                        expect(labels.filter(has_text=re.compile(r"^Google Drive:"))).to_have_count(0)
                        for title, menu_id, expected in [
                            ("Google Drive (advanced)", "jupyterlite-google-drive-advanced-menu", ["Renew authorization","Open native notebook (experimental)","Open notebook","Browse authorized notebooks","Save to original","Save a new copy","Refresh workspace list","New folder","Mount read-only data file (experimental)","Import data into Python","Export Python output as new file","Add selected data dependency","Remove recorded data dependency","Remember mounted data in notebook","Restore notebook data dependencies","Notebook and data status","Save local recovery copy","Download notebook recovery file","Download Python output locally"]),
                            ("Google Drive", "jupyterlite-google-drive-menu", ["Connect","Open folder","Save current notebook","Save current datafile","Disconnect"])
                        ]:
                            labels.filter(has_text=re.compile("^"+re.escape(title)+"$")).hover()
                            submenu=page.locator("#"+menu_id)
                            expect(submenu).to_be_visible(timeout=30000)
                            items=submenu.locator(".lm-Menu-itemLabel").filter(has_text=re.compile(r"\S"))
                            expect(items).to_have_text(expected)
                        expect(page.locator("#jupyterlite-google-drive-menu .lm-Menu-item").filter(has_text="Open folder")).to_have_class(re.compile("lm-mod-disabled"))
                        page.keyboard.press("Escape")
                        page.keyboard.press("Escape")
                        # The unconfigured build cannot execute Open folder.
                        # Use the actual offline status command to activate the panel,
                        # rather than toggling the JupyterLab sidebar tab.
                        workspace=page.locator("#jupyterlite-google-drive-sidebar")
                        expect(workspace.locator("h3").filter(has_text=re.compile(r"^Current notebook$"))).to_have_count(0)
                        expect(workspace.locator("button").filter(has_text=re.compile(r"^Refresh folder$"))).to_be_disabled()
                        expect(workspace.locator("button").filter(has_text=re.compile(r"^Connect$"))).to_be_disabled()
                        page.locator(".lm-MenuBar-item").filter(has_text="File").first.click()
                        page.locator(".lm-Menu:visible").first.get_by_text("Google Drive (advanced)",exact=True).hover()
                        submenu=page.locator("#jupyterlite-google-drive-advanced-menu")
                        expect(submenu).to_be_visible(timeout=30000)
                        submenu.get_by_text("Notebook and data status",exact=True).click()
                        expect(workspace).to_be_visible(timeout=30000)
                        expect(workspace.get_by_role("heading",name="Google Drive",exact=True)).to_be_visible()
                        expect(workspace.get_by_role("status")).to_contain_text("Configuration unavailable",timeout=30000)
                        expect(page.get_by_role("tab",name="welcome.ipynb",exact=True)).to_have_attribute("data-drive-origin","local",timeout=30000)
                        expect(workspace.get_by_role("button",name="Connect to Google Drive")).to_be_disabled()
                        advanced=workspace.locator("details").filter(has_text="Advanced actions")
                        expect(advanced).to_be_visible()
                        expect(advanced).not_to_have_attribute("open","")
                        expect(workspace.get_by_role("button",name="Download notebook recovery file")).to_be_visible()
                        expect(workspace.get_by_role("button",name="Import temporary data copy…")).to_be_hidden()
                        advanced.locator("summary").click()
                        expect(workspace.get_by_role("button",name="Import temporary data copy…")).to_be_visible()
                        expect(workspace.get_by_role("button",name="Save local recovery copy")).to_be_visible()
                        advanced.locator("summary").click()
                        expect(workspace.get_by_role("button",name="Import temporary data copy…")).to_be_hidden()
                        if args.site == "wheel-demo":
                            # Prove the installed environment actually executes Python.
                            cell=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                            cell.click()
                            page.keyboard.press("Control+Enter")
                            output=page.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first
                            expect(output).to_have_text("6",timeout=180000)
                            print("Installed wheel site executed the real Python kernel.")
                        print("JupyterLite notebook, two Drive submenus with connection-aware commands and collapsible advanced actions are verified.")
                    except Exception:
                        print("Visible JupyterLab dialogs:",page.locator(".jp-Dialog:visible").all_text_contents())
                        page.screenshot(path=str(root / "smoke-failure.png"), full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__ == "__main__":
    main()
