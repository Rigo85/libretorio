# Library file authentication

This is a deployment companion to `libraryFilesMiddleware`. It has not been
installed on the production proxy. The current proxy adds public cache headers
to PDF/image/CSS/JS responses based on the file extension, including library
contents. Updating only the backend is not the complete deployment.

## Deployment checks

1. Back up the current Libretorio Nginx site and the backend/frontend release.
2. Install `library-files.conf` as an Nginx snippet, and include it inside the
   Libretorio HTTPS `server`, **before** the existing regex locations by extension.
   The upstream and legacy alias in the snippet match the server inspected on
   2026-09-24; verify both against the deployment before applying it.
3. Build the frontend, copy its output to backend `src/browser`, then build and
   release the backend using the normal deployment process. Do not publish the
   backend with an old frontend: invalid/expired sessions now return HTTP 401.
4. Validate with `nginx -t` before reloading. Keep both authentication enforcement
   and the private-cache rule in place; the Nginx snippet alone does not authenticate.
5. Test the public HTTPS domain without cookies: GET, HEAD, Range and conditional
   requests to books, cache, covers and the legacy alias must return 401, never
   a file, 206, 304 or the login HTML. Test encoded path components as well.
6. With a valid session, test PDF, EPUB, comics, audiobook chapters and seeking.
   Range requests must still return 206. A second login must invalidate the first
   session. Logout/login without reloading the SPA must work.
7. Verify every protected response, including errors, has `Cache-Control:
   private, no-store` and no public cache policy or future `Expires` header.

The application shell, login page, PDF.js workers and other application assets
remain public. Library content and generated files do not.

Existing copies already downloaded or cached on a client cannot be revoked by a
server update. Test both a clean profile and clients with warm caches/open tabs.
If a shared/CDN cache is configured elsewhere, invalidate its existing library
entries as part of deployment; this snippet does not purge another cache.

## Session and client transition

- HTML and non-fingerprinted application files must revalidate. Do not override
  the backend's `no-cache` entry-document policy with a long-lived Nginx policy.
  Hashed JS/CSS bundles can retain their existing long cache lifetime.
- Publish backend and frontend together. Keep the previous public hashed bundles
  available during the transition, but never restore public access to books.
- An already open old SPA keeps its old CSRF interceptor. In the local transition
  test its logout returned 403 after publication; reloading the candidate restored
  normal logout. Tell users to finish their current operation and reload. A hard
  reload or cache-busted entry URL may be necessary for previously cached HTML.
  Do not disable CSRF, retry mutations automatically or forcibly reload readers.
- WebSocket handshakes now require an exact `Origin` matching `ALLOWED_ORIGIN`
  (default `https://libretorio.rji-services.org`). Preserve that browser header in
  the proxy. Check non-browser clients separately; do not allow every origin.
- Every WS command checks the active user's current session and its persisted
  expiry. Logout removes that persisted session. A DB validation failure blocks
  dispatch and closes with 1013, without reporting a permanent logout. A replaced
  or expired session closes with 1008. Already authorized in-flight operations
  and already downloaded bytes are not retroactively revoked.
- Inventory physical aliases before release. An extra symlink to library content
  outside the listed namespaces also needs a private-cache proxy rule; backend
  authentication alone does not cancel an `expires` directive in another location.
- The candidate also bounds WS inputs, current conversions and cover downloads.
  Review the limits and remaining converter isolation work in the local B0/B1
  report before accepting the release. This is not the scanner conversion queue.

Deployment remains separately authorized. On rollback, retain authentication and
private-cache enforcement; block material temporarily rather than restore the
old public-file behavior. No production changes were made by these tests.

## Local verification

Run `node tests/nginxLibraryFiles.integration.cjs` from the backend repository
with Node 24, Docker and the local `nginx:1.24-alpine` image available. It validates
the snippet and tests it against an isolated loopback backend, without TLS or
production credentials. Its temporary container and files are removed afterwards.
