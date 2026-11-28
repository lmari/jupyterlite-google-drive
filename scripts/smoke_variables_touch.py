"""Verify the Variables toolbar on a portrait tablet viewport in both engines."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]

def run(engine,name,url):
    browser=engine.launch()
    page=browser.new_page(has_touch=True,viewport={"width":768,"height":1024})
    try:
        page.goto(url,wait_until="domcontentloaded",timeout=120000)
        bar=page.get_by_role("toolbar",name="Notebook editing tools")
        expect(bar).to_be_visible(timeout=120000)
        button=bar.get_by_role("button",name="Variables",exact=True)
        # Python tools must be absent in Markdown and available in a code cell.
        page.locator(".jp-Notebook:visible .jp-MarkdownCell").first.tap()
        expect(button).to_have_count(0)
        expect(bar.get_by_role("button",name="Run",exact=True)).to_have_count(0)
        code=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
        code.tap()
        expect(bar.get_by_role("button").first).to_have_text("Run")
        button.tap()
        dialog=page.locator(".jp-Dialog:visible").filter(has_text="Python variables")
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button",name="Refresh variables")).to_be_visible()
        dialog.get_by_role("button",name="Close",exact=True).tap()
        expect(dialog).to_be_hidden()
        code=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
        code.tap()
        page.keyboard.press("Control+a")
        page.keyboard.insert_text("tablet_value = 42\nprint(tablet_value)")
        bar.get_by_role("button",name="Run",exact=True).tap()
        expect(page.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first).to_have_text("42",timeout=180000)
        button.tap()
        expect(dialog).to_be_visible()
        row=dialog.get_by_role("row").filter(has=page.get_by_role("cell",name="tablet_value",exact=True))
        expect(row.get_by_role("cell",name="42",exact=True)).to_be_visible(timeout=30000)
        # Actual close/reopen touch interactions, not just DOM presence.
        dialog.get_by_role("button",name="Close",exact=True).tap()
        expect(dialog).to_be_hidden()
        button.tap()
        expect(row.get_by_role("cell",name="42",exact=True)).to_be_visible(timeout=30000)
        dialog.get_by_role("button",name="Close",exact=True).tap()
        expect(dialog).to_be_hidden()
        # Contextual help should show a usable sidebar or a modal fallback.
        code.tap()
        page.keyboard.press("Control+a")
        page.keyboard.insert_text("len")
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        bar.get_by_role("button",name="Help",exact=True).tap()
        help_panel=page.locator("#jupyterlite-python-help")
        help_dialog=page.locator(".jp-Dialog:visible").filter(has_text="Python contextual help")
        expect(help_panel.locator("pre").or_(help_dialog.locator("pre")).first).to_contain_text("number of items",timeout=30000)
        if not help_dialog.is_visible():
            expect(help_panel).to_be_visible()
            help_panel.get_by_role("button",name="Open in window").tap()
        expect(help_dialog).to_be_visible()
        expect(help_dialog.locator("pre")).to_contain_text("number of items")
        help_dialog.get_by_role("button",name="Close",exact=True).tap()
        expect(help_dialog).to_be_hidden()
        print(name+": portrait Variables dialog and contextual help opened, populated and closed by touch.")
    except Exception:
        print(name+":",page.locator(".jp-Dialog:visible").all_text_contents())
        page.screenshot(path=str(ROOT/("variables-touch-"+name+".png")),full_page=True)
        raise
    finally:
        browser.close()

def main():
    with TemporaryDirectory() as temp:
        site=Path(temp)/"jupyterlite-google-drive"
        shutil.copytree(ROOT/"dist",site)
        with ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url=f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    for name in ("chromium","firefox"):
                        run(getattr(pw,name),name,url)
            finally:
                server.shutdown()

if __name__=="__main__":
    main()
