# Big Naturals Food Co. — web

The static landing page uses Nuxt, TypeScript, and Tailwind CSS, with system
fonts and local assets. There is no production application server, API, or
email signup form.

## Setup

Use Node 24.15 or newer within Node 24 (see the root `.nvmrc`). From the
repository root:

```sh
cd web
npm ci
```

All commands below run from `web/`.

## Local preview while editing

```sh
npm run dev
```

Open <http://127.0.0.1:3000>. Changes reload automatically. Use the URL printed
in the terminal if port 3000 is occupied. Stop the server with **Ctrl+C**.
This runs locally and does not deploy to AWS.

The page lives in `app/app.vue`; Tailwind theme colors and shared styles live
in `app/assets/css/main.css`.

Email signup lives in `app/components/SignupForm.vue`. Its public settings come
from `../cloud/signup.json`; provider secrets stay in AWS and never enter the
Nuxt build. The form stays hidden while `enabled` is false. See
[provider setup and activation](../cloud/SIGNUP.md).

## Validate and generate

```sh
npm run typecheck
npm run generate
npm run test:e2e
```

The publishable output is `.output/public/`. HTML is prerendered at build time.
Browser tests use installed Google Chrome locally (Playwright Chromium in CI),
start/stop a local server on port 4173, and mock Turnstile and the signup API.
They use test-only runtime overrides, never production credentials or contacts.
Neither `200.html` nor `404.html` is emitted. CloudFront will redirect unknown
page URLs to `/` once infrastructure is implemented; local preview does not
simulate that behavior.

## Preview the generated static files

After `npm run generate`, use Python 3 to serve the output:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory .output/public
```

Open <http://127.0.0.1:4173>. Regenerate after changing source files and refresh
the browser. Stop the server with **Ctrl+C**.

## Verification notes

Typechecking and static generation passed on November 4, 2026. The generated
page was checked in headless Chrome at widths of 320, 390, 768, and 1440 pixels,
with no horizontal overflow, browser errors, or external requests. This check
served generated files through browser request interception without starting a
local server.

The dependency audit reports 12 affected packages (6 low, 6 moderate; no high or
critical findings) in Nuxt's transitive build/server tooling. The reported
automatic remediation proposes downgrading Nuxt to 4.1.3; it has not been
applied. Track upstream fixes during dependency maintenance. Only the generated
static files are intended for deployment, not the build/server tooling.
