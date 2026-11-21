# Big Naturals Food Co. — web

## Goose Nibbles ingredient manifest

With the business-os server running, refresh the local review manifest from the
website repository root:

```sh
python3 scripts/update-goose-nibbles.py
```

The updater reads Cranberry Caboodle v1, Violet’s Demise v2, and Eve Did It
(Apple) v2 and their selected products at one business-os revision. These
versions are explicit, independent of the server's current-version flags.
It writes `web/data/goose-nibbles.json` without changing
business-os. Use `--server` to select another server or `--output` for another
destination. Repeat the command when source recipes or product labels change.

The file contains flavor names and ingredient names in weight order. Repeated
ingredients are combined across recipe sections. Missing weights can use the
estimates in `scripts/goose-nibbles-estimates.json`; the command prints which
ones it used. Business-os measurements take precedence. The update stops if an
ingredient has neither a weight nor an estimate.

Run the updater checks with `python3 -m unittest discover -s scripts -p 'test_*.py'`.

The static site uses Nuxt, TypeScript, and Tailwind CSS, with the local
Luckiest Guy display font and brand artwork copied from `../business-os/brand`.
Email signup uses the separately configured AWS API.

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

For local Cloudflare widget testing, copy `.env.example` to `.env` (already
configured in this checkout), then restart `npm run dev`. The
`BNFC_DEV_TURNSTILE_SITE_KEY` setting is applied only in development. Static
production builds keep the real key from `cloud/signup.json`. Do not put the
`NUXT_PUBLIC_TURNSTILE_SITE_KEY` override in `.env`, since it also affects builds.
With `BNFC_DEV_SIGNUP_MOCK=true` in `.env`, the local form posts to a development-only
endpoint and displays its normal success message. The endpoint does not send,
store, or log addresses. Both this mock and the test widget are enabled in
`.env.example`. Set the mock to `false` to use the configured API instead.
Production builds always use the real API; local test tokens are not valid there.

The shared header and footer live in `app/app.vue`. Home is `app/pages/index.vue`;
Goose Nibbles is `app/pages/goose-nibbles.vue`. Tailwind theme colors and shared styles live
in `app/assets/css/main.css`. Brand assets and the font license are under
`app/assets/brand` and `app/assets/fonts`; Nuxt bundles them into `/_nuxt/`,
which the existing CloudFront asset routing supports.

`app/components/SiteHeader.vue` provides a top-right hamburger menu: a desktop
dropdown and full-screen mobile dialog with keyboard focus management. It
links to Home (`/`) and Goose Nibbles (`/goose-nibbles`), with the current page
marked in navigation.

Goose Nibbles renders the checked-in ingredient manifest in its existing order,
as one combined ingredient paragraph per flavor. Cranberry Caboodle uses light
coral, Violet’s Demise uses blue, and Eve Did It uses light green. Each section
uses the shared goose mascot and a labeled SVG bar placeholder; replace the
placeholder when product photos are ready. The page includes the shared signup
form and “Nutrition information is not yet available.”

`app/components/SignupPanel.vue` combines the goose artwork, introductory copy,
green panel, and signup form on both pages. Its responsive layout is shared;
Home uses an h1 and Goose Nibbles uses an h2 for the panel heading.
Email signup behavior lives in `app/components/SignupForm.vue`. Its public settings come
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
The test server uses `.nuxt/e2e` so a separate development preview can stay open.
They use test-only runtime overrides, never production credentials or contacts.
Neither `200.html` nor `404.html` is emitted. The CloudFront function serves
`/goose-nibbles` from `goose-nibbles/index.html`, canonicalizes its trailing slash
and explicit index URLs, and redirects unknown page URLs to `/`. Local preview
does not simulate those edge redirects. The publication checker requires both
pages and verifies their HTML, referenced assets, payloads, and redirects.

## Preview the generated static files

After `npm run generate`, use Python 3 to serve the output:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory .output/public
```

Open <http://127.0.0.1:4173>. Regenerate after changing source files and refresh
the browser. Stop the server with **Ctrl+C**.

## Verification notes

The Goose Nibbles page passed typechecking, static generation, and desktop/mobile
browser checks on November 21, 2026. Checks cover the manifest text, images,
distinct flavor colors, navigation between pages, signup, and content without
JavaScript. Desktop and 320px screenshots were inspected. Routing/publication
tests passed, and the actual generated output passes the publication plan.
The new CloudFront route and page have not been deployed or verified on AWS.

The brand refresh passed typechecking, static generation, and 18 desktop/mobile
browser checks on November 21, 2026. Checks cover signup with mocked services,
navigation layout, keyboard focus, Escape, and the Home link. Desktop and
320px screenshots were inspected. Generated HTML asset references resolve locally.
These checks do not verify live signup infrastructure or deployment.

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
