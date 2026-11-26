# Python data files: 0.3

JupyterLite's Pyodide file synchronization is based on the Emscripten filesystem and browser transport (SharedArrayBuffer or service worker). The successful native notebook test does not demonstrate that arbitrary files in the additional GoogleDrive mount are accessible from Python. See https://jupyterlite.readthedocs.io/en/stable/howto/content/python.html and https://jupyterlite.readthedocs.io/en/stable/reference/contents.html.

## First increment

Explicit Picker selection, regular binary file download using the existing drive.file authorization, size and version guard, user confirmation, and byte-preserving transfer via the active Python kernel's standard execute request. The fixed routine decodes base64 into an exclusive file under /tmp/jupyterlite-drive/. No token, remote identifier, or arbitrary data is interpreted as code. No new dependencies. No changes to the notebook model. No remote writes. A 5 MiB per-file limit bounds memory/message size; filename sanitation prevents traversal. The temporary file is accessible through ordinary Python I/O even with service workers blocked, and is lost when the kernel restarts. Collision refuses the operation.

## Verification

Node tests cover bytes, path sanitization, size guards, version checks, kernel status and error handling. Browser test selects a simulated CSV, imports it into a real Pyodide kernel, refuses a repeat import and reads the CSV using Python's standard csv module inside the native notebook. Preserve the existing notebook tests.

## Later increments

Investigate exposing an authorized data tree via Contents.IDrive and DriveFS, including kernel path handling, service worker/SharedArrayBuffer behavior and cross-device reauthorization. Do not equate this explicit temporary snapshot with a remote filesystem. Consider user-selected data dependencies and optional upload of generated files as distinct operations; no automatic remote writes of data until conflict semantics are designed.

## Compatibility with Pyodide 0.8.7

Run 45887742854 failed on the duplicate-file message after the first import succeeded. The upstream interpreter serializes exception types using str(etype), not __name__, so recognize both FileExistsError and its Python class representation. The browser test changes the fake remote CSV before retrying and verifies the first local snapshot is preserved. Pyodide also internally calls run_cell with store_history=True despite the execute request asking for no history; encoded data may remain in kernel history until restart. Do not use this prototype for sensitive data. References: https://github.com/jupyterlite/pyodide-kernel/blob/v0.8.7/packages/pyodide-kernel/py/pyodide-kernel/pyodide_kernel/interpreter.py and kernel.py in the same directory.

## Alpha 2: native read-only data paths

Pyodide 0.8.7 initializes DriveFS at /drive for the drive name associated with the kernel session, when service worker support or crossOriginIsolated is available. JupyterLite DriveContentsProcessor obtains file content using ContentsManager.get and accepts base64 for binary data. Add a read-only data/ directory to NativeDrive with explicit Picker-selected aliases. Keep auth on the frontend; do not use execute requests for mounted data. Data paths cannot invoke notebook writes. Unit-test metadata, binary encoding, alias collisions and account reset. A separate Chromium test serves COOP/COEP headers to exercise the actual SharedArrayBuffer bridge, reads a CSV twice after a remote edit, and checks no remote writes. GitHub Pages service-worker transport still requires separate acceptance. No persistent aliases or arbitrary data file writes.

## Alpha 3: explicit export

The output/ directory on NativeDrive is a writable in-memory staging area, not a remote write-through filesystem. DriveFS create and save operations are limited to safe flat file names and bounded bytes. The browser UI chooses a snapshot, confirms, then creates a new Drive file by multipart POST. No remote data overwrite, no OAuth scope expansion, no credential in the kernel. Output survives a failed upload but not connection reset or browser reload. Tests assert binary round trip and absence of uploads before confirmation. Real Pages service-worker transport still needs verification.
