# Python data files: 0.3

JupyterLite's Pyodide file synchronization is based on the Emscripten filesystem and browser transport (SharedArrayBuffer or service worker). The successful native notebook test does not demonstrate that arbitrary files in the additional GoogleDrive mount are accessible from Python. See https://jupyterlite.readthedocs.io/en/stable/howto/content/python.html and https://jupyterlite.readthedocs.io/en/stable/reference/contents.html.

## First increment

Explicit Picker selection, regular binary file download using the existing drive.file authorization, size and version guard, user confirmation, and byte-preserving transfer via the active Python kernel's standard execute request. The fixed routine decodes base64 into an exclusive file under /tmp/jupyterlite-drive/. No token, remote identifier, or arbitrary data is interpreted as code. No new dependencies. No changes to the notebook model. No remote writes. A 5 MiB per-file limit bounds memory/message size; filename sanitation prevents traversal. The temporary file is accessible through ordinary Python I/O even with service workers blocked, and is lost when the kernel restarts. Collision refuses the operation.

## Verification

Node tests cover bytes, path sanitization, size guards, version checks, kernel status and error handling. Browser test selects a simulated CSV, imports it into a real Pyodide kernel, refuses a repeat import and reads the CSV using Python's standard csv module inside the native notebook. Preserve the existing notebook tests.

## Later increments

Investigate exposing an authorized data tree via Contents.IDrive and DriveFS, including kernel path handling, service worker/SharedArrayBuffer behavior and cross-device reauthorization. Do not equate this explicit temporary snapshot with a remote filesystem. Consider user-selected data dependencies and optional upload of generated files as distinct operations; no automatic remote writes of data until conflict semantics are designed.
