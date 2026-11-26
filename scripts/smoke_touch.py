"""Compare real browser touch dispatch, without mouse clicks or hover.

Run exactly the same script against the 0.8.7 baseline and 0.9.0b2 candidate.
Playwright's desktop browser engines emulate touch; this does not certify
physical Android/iPad hardware.
"""
import argparse
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from tempfile import TemporaryDirectory
import shutil
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

def tap_file(page):
    page.locator(".lm-MenuBar-item").filter(has_text=re.compile(r"^File$")).tap()
    expect(page.locator(".lm-Menu:visible").first).to_be_visible(timeout=5000)
    # The reported defect is closure on the follow-up click; verify that the
    # menu survives the complete tap and subsequent event processing.
    page.wait_for_timeout(450)
    expect(page.locator(".lm-Menu:visible").first).to_be_visible(timeout=1000)

def tap_submenu(page, title, menu_id=None):
    labels = page.locator(".lm-Menu:visible").first.locator(".lm-Menu-itemLabel")
    labels.filter(has_text=re.compile("^"+re.escape(title)+"$")).tap()
    page.wait_for_timeout(450)
    if menu_id:
        submenu = page.locator("#"+menu_id)
        expect(submenu).to_be_visible(timeout=5000)
    else:
        expect(page.locator(".lm-Menu:visible")).to_have_count(2,timeout=5000)
        submenu = page.locator(".lm-Menu:visible").last
    return submenu

def run_browser(engine, url, diagnostic_dir, name):
    browser = engine.launch()
    context = browser.new_context(has_touch=True, viewport={"width":1280,"height":900},
                                  accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.add_init_script("""window.__touchTrace = [];
      for (const type of ['pointerdown','pointerup','click']) {
        document.addEventListener(type, e => {
          window.__touchTrace.push({type:e.type,pointerType:e.pointerType||'',
            target:e.target?.className?.toString().slice(0,120)||''});
        }, true);
      }""")
    stage = "load"
    try:
        page.goto(url,wait_until="domcontentloaded",timeout=120000)
        expect(page.locator(".jp-Notebook:visible").first).to_be_visible(timeout=120000)
        stage = "ordinary Drive submenu"
        tap_file(page)
        ordinary = tap_submenu(page,"Google Drive","jupyterlite-google-drive-menu")
        stage = "ordinary command"
        ordinary.get_by_text("Show workspace",exact=True).tap()
        expect(page.locator("#jupyterlite-google-drive-sidebar")).to_be_visible(timeout=10000)
        expect(ordinary).to_be_hidden()
        stage = "advanced Drive submenu"
        tap_file(page)
        advanced = tap_submenu(page,"Google Drive (advanced)","jupyterlite-google-drive-advanced-menu")
        stage = "advanced command"
        with page.expect_download(timeout=10000) as event:
            advanced.get_by_text("Download notebook recovery file",exact=True).tap()
        assert event.value.suggested_filename.endswith(".ipynb")
        assert json.loads(event.value.path().read_text())["nbformat"] == 4
        stage = "native JupyterLab submenu"
        tap_file(page)
        new_menu = tap_submenu(page,"New")
        stage = "native JupyterLab command"
        new_menu.get_by_text("Text File",exact=True).tap()
        expect(page.locator(".jp-FileEditor:visible").first).to_be_visible(timeout=15000)
        trace = page.evaluate("window.__touchTrace")
        assert any(e["pointerType"]=="touch" and e["type"]=="pointerdown" for e in trace), "No touch pointer events observed"
        print(f"{name}: PASS (ordinary, advanced and native menus; touch pointer events observed)",flush=True)
        return True
    except Exception as exc:
        print(f"{name}: FAIL at {stage}: {exc}",flush=True)
        print("Touch trace:",page.evaluate("window.__touchTrace"),flush=True)
        print("Visible menus:",page.locator(".lm-Menu:visible").all_text_contents(),flush=True)
        print("Visible dialogs:",page.locator(".jp-Dialog:visible").all_text_contents(),flush=True)
        page.screenshot(path=str(diagnostic_dir/f"touch-{name}.png"),full_page=True)
        return False
    finally:
        context.close()
        browser.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--site",default=str(ROOT/"dist"))
    parser.add_argument("--diagnostics",default=str(ROOT))
    args=parser.parse_args()
    diagnostic_dir=Path(args.diagnostics).resolve()
    diagnostic_dir.mkdir(parents=True,exist_ok=True)
    results={}
    with TemporaryDirectory() as temp:
        site=Path(temp)/"jupyterlite-google-drive"
        shutil.copytree(Path(args.site).resolve(),site)
        with ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,directory=temp)) as server:
            Thread(target=server.serve_forever,daemon=True).start()
            url=f"http://127.0.0.1:{server.server_port}/jupyterlite-google-drive/lab/index.html?path=welcome.ipynb"
            try:
                with sync_playwright() as pw:
                    for name in ("chromium","firefox"):
                        results[name]=run_browser(getattr(pw,name),url,diagnostic_dir,name)
            finally:
                server.shutdown()
    (diagnostic_dir/"touch-results.json").write_text(json.dumps(results,indent=2)+"\n")
    print("Touch comparison result:",results,flush=True)
    if not all(results.values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
