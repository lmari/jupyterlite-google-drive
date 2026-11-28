# Google Cloud configuration: troubleshooting and deployment notes

The complete setup procedure is in [README > Google Cloud setup](../README.md#google-cloud-setup), including API activation, OAuth branding and audience, test users, the restricted browser key, numeric project number, local configuration and GitHub Pages deployment. Follow it before using the checks below. Only the site operator needs a Cloud project.

## Common problems

| Symptom | What to check |
|---|---|
| Drive sidebar: Configuration unavailable | Verify that all three runtime values are present in the generated jupyter-lite.json. For Pages, check the Actions repository variables and rebuild. For local builds, check demo/jupyter-lite.json or the environment variables. |
| Google OAuth says access is blocked or the app is in testing | In the selected Cloud project, open Google Auth Platform > Audience. Add the exact Google account under Test users, and select that account when connecting. Check Workspace organization policies if applicable. |
| origin_mismatch | In Google Auth Platform > Clients, add the exact scheme, hostname and port as an Authorized JavaScript origin. Never add a path, wildcard or trailing slash. |
| API developer key is invalid in Picker | Confirm both APIs are enabled, that the key belongs to the same project, and that website restrictions include the hosting origin and https://docs.google.com/*. Check API restrictions for Drive and Picker. |
| Picker opens but the notebook list is empty | The drive.file scope is intentionally per-file. Select an existing notebook through Picker, or save a new Drive copy, then refresh the list. |
| Authorization expired / HTTP 401 | Choose Renew authorization in the Drive sidebar, selecting the original account. Retry the failed operation explicitly. |
| Google services do not load or no consent window appears | Open the site directly, check network access and browser popup settings. Test in another browser profile if necessary. Do not disable browser security globally. |
| Changes to Pages configuration are not visible | Run a new build and verify deployment succeeded. After saving or downloading current work, reload the site; a service worker or cache can still serve an earlier build. |
| Python cannot open /drive/data | Check that the notebook is open in native remote mode and the file is mounted. The filesystem bridge requires a supported browser and secure context (HTTPS or localhost). Try the temporary import fallback; it uses a different path. |

Check the public configuration in the site's jupyter-lite.json by looking at its three property names and confirming values are set. Do not copy access tokens, account passwords, client secrets, private file IDs or notebook contents into screenshots, logs or issue reports.

## Origins and key restrictions

For the original project, the Pages URL is https://lmari.github.io/jupyterlite-google-drive/lab/index.html, but its OAuth origin is only https://lmari.github.io. The corresponding browser API key referrer is https://lmari.github.io/*. For a fork, substitute the actual host. The extra Picker referrer https://docs.google.com/* is necessary because Picker is hosted in an iframe on that domain.

Localhost is useful for desktop development. Accessing a local HTTP server on another device via a LAN IP is not equivalent to a secure localhost origin; it can be used for unconfigured UI tests, not full Google/DriveFS acceptance. Prefer HTTPS Pages for real tablet tests.

## Broader deployment

For a personal test, an External audience in Testing mode with explicitly allowed accounts is appropriate. For an institutional deployment, assess the Internal audience if the organization supports it, or the External app requirements. Check Google's current publishing, verification and user-limit rules, including the requirements for app branding and privacy documentation. Do not request broader scopes to avoid a consent error. A dedicated trusted HTTPS origin is preferable because scripts under the same origin share a security boundary; project paths on GitHub Pages do not isolate applications.

The deployment operator supplies the public OAuth client ID, restricted browser API key and numeric project number. End users grant their own per-file permissions, using their own accounts. The project does not use a client secret or a service account.

Continue with the [real-account acceptance checklist](acceptance.md) before pilot classroom use.

Official documentation:

- [OAuth consent and scopes](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Google Picker integration and referrer restrictions](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [API key restrictions](https://docs.cloud.google.com/docs/authentication/api-keys)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
