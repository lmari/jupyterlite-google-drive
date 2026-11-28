"""Touch-only editing actions in a real notebook and Python kernel.

Keyboard input is used only to set up test text; buttons and suggestions are
activated with Playwright tap, not keyboard shortcuts.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import re
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]

def main():
    with TemporaryDirectory() as temp:
        site=Path(temp)/"jupyterlite-google-drive"
        shutil.copytree(ROOT/"dist",site)
        with ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url=f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    browser=pw.chromium.launch()
                    page=browser.new_page(has_touch=True,viewport={"width":1280,"height":900})
                    page.on("pageerror",lambda e: print("Browser error:",e))
                    try:
                        page.goto(url,wait_until="domcontentloaded",timeout=120000)
                        bar=page.get_by_role("toolbar",name="Notebook editing tools")
                        expect(bar).to_be_visible(timeout=120000)
                        md=page.locator(".jp-Notebook:visible .jp-MarkdownCell").first
                        md.tap()
                        edit=bar.get_by_role("button",name="Edit Markdown",exact=True)
                        expect(edit).to_be_enabled()
                        # Verify the actual hit target, not merely CSS visibility.
                        assert edit.evaluate("""el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }"""), "Editing toolbar is covered by notebook content"
                        edit.tap()
                        expect(md.locator(".cm-content")).to_be_visible()
                        bar.get_by_role("button",name="Render Markdown",exact=True).tap()
                        expect(md.locator(".jp-RenderedMarkdown")).to_be_visible()
                        expect(md.locator(".cm-content")).to_be_hidden()
                        code=page.locator(".jp-Notebook:visible .jp-CodeCell .cm-content").first
                        code.tap()
                        page.keyboard.press("Control+Enter") # setup: import statistics
                        expect(page.locator(".jp-Notebook:visible .jp-CodeCell .jp-OutputArea-output").first).to_have_text("6",timeout=180000)
                        code.tap()
                        page.keyboard.press("Control+a")
                        page.keyboard.insert_text("statistics.me")
                        expect(code).to_have_text("statistics.me")
                        bar.get_by_role("button",name="Indent",exact=True).tap()
                        expect(code).to_have_text(re.compile(r"^\s+statistics\.me$"),use_inner_text=False)
                        bar.get_by_role("button",name="Dedent",exact=True).tap()
                        expect(code).to_have_text("statistics.me")
                        # Set an unambiguous end-of-token cursor after indentation.
                        code.tap()
                        page.keyboard.press("End")
                        bar.get_by_role("button",name="Complete",exact=True).tap()
                        suggestion=page.locator(".jp-Completer:visible .jp-Completer-item[data-value='mean']")
                        expect(suggestion).to_be_visible(timeout=30000)
                        suggestion.tap()
                        expect(code).to_have_text("statistics.mean")
                        # Position within the function name and request native kernel inspection.
                        code.tap()
                        page.keyboard.press("End")
                        page.keyboard.press("ArrowLeft")
                        bar.get_by_role("button",name="Help",exact=True).tap()
                        inspector=page.locator(".jp-Dialog:visible").filter(has_text="Python contextual help")
                        expect(inspector).to_be_visible(timeout=30000)
                        expect(inspector).to_contain_text(re.compile("arithmetic mean",re.I),timeout=30000)
                        inspector.get_by_role("button",name="Close",exact=True).tap()
                        expect(inspector).to_be_hidden()
                        print("Touch editing tools verified: Markdown render, indentation, real Python completion and contextual help.")
                    except Exception:
                        print("Visible dialogs:",page.locator(".jp-Dialog:visible").all_text_contents())
                        print("Editing toolbar status:",page.locator(".jp-TouchEditingTools [role=status]").all_text_contents())
                        page.screenshot(path=str(ROOT/"editing-failure.png"),full_page=True)
                        raise
                    finally:
                        browser.close()
            finally:
                server.shutdown()

if __name__=="__main__":
    main()
