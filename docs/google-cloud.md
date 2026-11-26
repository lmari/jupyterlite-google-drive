# Google Cloud configuration for the alpha demo

The static demo can be used without Google. To enable Drive, the owner of the
deployment needs to create a Google Cloud project. Start in testing mode using
a disposable notebook. No service account, billing-dependent compute,
backend, client secret, or permanent refresh token is required.

## Google Cloud Console

1. Open https://console.cloud.google.com/ and create or select a dedicated
   project (e.g. `JupyterLite Google Drive`).
2. In APIs & Services > Library, enable **Google Drive API** and
   **Google Picker API**.
3. In Google Auth Platform, configure Branding (app name, support email,
   developer contact), Audience (External if appropriate; Testing; add
   your Google account to Test users), and Data Access. Request only
   `https://www.googleapis.com/auth/drive.file` for Drive.
4. In Clients, create an OAuth client of type **Web application**.
   Authorized JavaScript origins: `https://lmari.github.io` (no path or
   trailing slash). For local development add `http://localhost` and
   `http://localhost:8000`. No redirect URI is needed for the token model.
   Copy the client ID (ends in `.apps.googleusercontent.com`); do not use
   a client secret.
5. In APIs & Services > Credentials, create an API key. Under application
   restrictions select Websites and allow
   `https://lmari.github.io/*` and `https://docs.google.com/*`.
   Picker runs in an iframe from docs.google.com, which must be allowed.
   Add a localhost referrer only if needed for development. Under API
   restrictions select Google Picker API and Google Drive API.
6. Find the numeric **Project number** in the project dashboard or
   IAM & Admin > Settings. This is the Picker App ID, not the project ID.

All three public values must come from the same project.

## GitHub

Open https://github.com/lmari/jupyterlite-google-drive/settings/variables/actions
and create the following **repository variables** (not secrets):

| Name | Value |
|---|---|
| GOOGLE_DRIVE_CLIENT_ID | OAuth web client ID |
| GOOGLE_DRIVE_API_KEY | restricted browser API key |
| GOOGLE_DRIVE_APP_ID | numeric Google Cloud project number |

These are intentionally visible to browsers in the deployed configuration.
Do not place client secrets, access tokens or account passwords here.

Go to https://github.com/lmari/jupyterlite-google-drive/actions, select
Build and test > Run workflow, choose main and enable deploy. Wait for
both build and deploy to succeed. Alternatively set PAGES_ENABLED=true
to enable subsequent deployments on pushes to main.

## First real test

Open https://lmari.github.io/jupyterlite-google-drive/lab/index.html directly,
not in an iframe. Reload if an older service worker caches the site.
Use File > Google Drive: Connect, then Open notebook; choose a disposable
.ipynb from Drive. Edit and run a cell, Save to original, then repeat the
open step from another browser on the same account. Verify that the edit
appears. Try the conflict and isolation tests in README.

If Google shows origin_mismatch, check the exact OAuth origin; if Picker
reports an invalid developer key, check the referrer and API restrictions.
If no Google configuration is detected, check the repository variables and
the deployed jupyter-lite.json. A test account or institutional Workspace
administrator may impose additional restrictions.

Public release requires a review of Google's OAuth policies, a privacy notice
and an origin dedicated to trusted application code. A project path on
GitHub Pages does not isolate it from other sites under lmari.github.io.

Official references:
- https://developers.google.com/workspace/drive/picker/guides/web-picker-sample
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/identity/protocols/oauth2/policies
