# Deploy the temporary site

Release the refreshed home page and `/goose-nibbles`, with the checked-in
ingredient manifest, signup panels, and matching CloudFront routing.
Allow about 20–30 minutes for preflight and review, plus 10–20 minutes for the
GitHub deployment after checks pass. Authentication or infrastructure recovery
can add time.

The user owns commits, pushes, PR creation, merging, and deployment. This
workflow documents those actions; local verification does not execute them.
General reference: [deployment and rollback](../DEPLOYMENT.md),
[AWS access](../ACCESS.md), and [signup](../SIGNUP.md).

## 1. Verify the local release

Run from the repository root with Node 24.15 or newer within Node 24:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
npm --prefix cloud/aws run typecheck
npm --prefix cloud/aws test
npm --prefix cloud/aws run synth
npm --prefix cloud/aws run synth:access
npm --prefix web run typecheck
npm --prefix web run generate
npm --prefix web run test:e2e
npm --prefix cloud/aws run publish:site -- --dry-run
git diff --check
```

Install locked dependencies with `npm ci --prefix web` and
`npm ci --prefix cloud/aws` first if they are missing. Generate before running
browser tests: the production tests read `web/.output/public/`. Tests use local
Chrome; GitHub installs Playwright Chromium. Provider requests are mocked, so
tests do not create contacts or verify production credentials.

When recipes or supplier information changed, first start business-os and run:

```sh
python3 scripts/update-goose-nibbles.py
```

Review the manifest diff and reported weight estimates before regenerating.
The updater deliberately selects Cranberry Caboodle v1, Violet’s Demise v2,
and Apple v2; it does not follow current-version flags. It combines ingredient
weights across sections and excludes removed inputs. The public manifest is
an ingredient-name list; it does not include supplier subingredient declarations,
allergen statements, or validated nutrition data. This verification confirms
the selected source-to-page output, not packaging-label completeness.

The local page and generated-output checks cover both routes, navigation,
mobile overflow, image loading, ingredient order, signup success/error states,
and production hydration. Edge routing is executed locally against the actual
generated files; that is not evidence of deployed CloudFront behavior.

## 2. Refresh the read-only AWS preflight

The November 21 preflight passed after renewing the local login. If the session
has expired again, renew it; confirm the account and rerun the checks when the
release source or AWS state changes:

```sh
aws login --profile default
aws sts get-caller-identity --profile default
npm --prefix cloud/aws run verify:signup-access -- --profile default --policy proposed --permissions-only
npm --prefix cloud/aws run verify:signup-access -- --profile default
aws cloudformation describe-stacks --profile default --region us-east-1 \
  --stack-name BigNaturalsFoodCoSite \
  --query 'Stacks[0].{Status:StackStatus,TerminationProtection:EnableTerminationProtection,Outputs:Outputs}'
```

Expected account: `066540957026`; region: `us-east-1`. The preflight checks
deployed roles, signup stack state, retained-log-group collisions, and the
API Gateway service role without reading secret values. The site stack must
be stable, not in a failed creation or in-progress operation.

On November 21, proposed and live policies each passed 115/115 checks. Signup
was `CREATE_COMPLETE`, the site was `UPDATE_COMPLETE`, and CloudFront was
deployed and enabled. There was no unmanaged signup log-group collision;
the API Gateway service role existed. Nine additional IAM simulations allowed
the CloudFormation role to read/update/publish the existing routing function
and read/update the distribution, and the GitHub role to create/read its
invalidations. IAM simulation does not establish actual deployment behavior.

Do not treat the old `ROLLBACK_COMPLETE` notes as current. GitHub
[run 41939388598](https://github.com/big-naturals-food-co/website/actions/runs/41939388598)
successfully deployed both stacks and verified HTTPS for `1fb7b49` on
November 4, 2026 (America/Chicago). Only pursue the
[historical recovery procedure](../SIGNUP.md#failed-initial-deployment-recovery)
if a fresh check identifies a current blocker. IAM changes or recovery remain
separate user actions, followed by another preflight.

## 3. Pass GitHub checks before merging

Review the local diff, commit and push it to a branch, and open a PR to `main`.
Confirm **Build and check** succeeds on the final PR revision. It runs the
infrastructure tests/synthesis, ingredient-updater tests, Nuxt build, browser
checks, and publication dry run without AWS deployment credentials.

```sh
gh pr checks <PR-number>
```

Resolve failures locally and rerun checks on the updated PR. Do not merge to
test whether the release works. The previous successful run does not validate
the new source: no GitHub run existed for local commit `15c9a58` at review time.
Uncommitted changes from this verification also need their own PR checks.

## 4. Deploy the checked revision

After local checks, live preflight, and the final PR checks pass, the user
squash-merges the PR. This triggers the existing
[Site workflow](../../.github/workflows/deploy.yml). There is no manual dispatch.

Monitor **Build and check** and **Deploy production** on the resulting main
commit. The workflow saves the generated site artifact, obtains GitHub OIDC
credentials, stores the configured signup secrets, deploys both stacks, uploads
assets before HTML, invalidates CloudFront, and verifies public files/redirects.
It does not deploy the administrator-owned IAM access stack.

```sh
gh run list --workflow deploy.yml --branch main --limit 5
gh run view <run-id> --json headSha,status,conclusion,jobs,url
```

Match `headSha` to the intended main commit. Never rerun an outdated deployment
to roll back; the workflow rejects runs that are no longer the main tip.

## 5. Verify the published site and signup

Open both pages on desktop and a phone, including the actual sampler QR code:

- `https://bignaturalsfoodco.com/`: new branding, navigation, and signup panel.
- `https://bignaturalsfoodco.com/goose-nibbles`: all three flavor sections,
  ingredient paragraphs, mascot avatars, and labeled bar placeholders.
- `/goose-nibbles/`, `/goose-nibbles/index.html`, and the `www` equivalent:
  redirect to the canonical `/goose-nibbles` route. An unknown page redirects home.
- Submit an email you control through the real Turnstile widget and confirm
  success plus membership in Brevo list `4`. Confirm the shared form on both
  pages; repeat signup must not create a duplicate or clear an unsubscribe.

The workflow's `verify:site` compares both pages, assets, and payloads with its
exact build artifact. If running that command locally after deployment, use
the artifact from that run in `web/.output/public/`; regenerating locally can
produce a different Nuxt build ID. The static checker does not verify Brevo
membership or a real Turnstile challenge.

If deployment fails, inspect the failed job and CloudFormation events before
retrying. Publication does not delete old files or versions. A frontend rollback
uses a new PR and preserves the required two-page output; rolling back to the
old one-page site also requires coordinated routing/publication changes.
See [failure and rollback](../DEPLOYMENT.md#failure-and-rollback).

## Verification record — November 21, 2026

Local validation started from `15c9a58`. Routing already supported Goose
Nibbles. Generated-browser verification found that imported image URLs differed
between server HTML and client hydration; Vite now emits matching root-relative
asset URLs, with a production regression check included in browser tests.

| Check | Result |
| --- | --- |
| Ingredient updater | Six tests passed; a fresh read of business-os revision 49 exactly matched the checked-in manifest, using the documented estimates |
| Infrastructure/backend | Typecheck, 35 Node tests, seven Python secret-transfer tests, and site/signup/access synthesis passed |
| Final browser suite | 33 passed, including generated-page regression checks; one desktop-only geometry check intentionally skipped on mobile |
| Production output | Both pages and 24 publication files validated; 320/390/768/1440px checks passed with no hydration warnings or overflow; mobile/desktop screenshots inspected; generated ingredients also checked without JavaScript |
| Live QR URL | Returned 302 to `/`; the new route is not deployed yet |
| Live AWS preflight | 115/115 proposed and 115/115 live policy checks passed, plus nine CloudFront checks; healthy site/signup stacks and no retained-resource blocker |
| GitHub | Previous release succeeded; this release has no integration result yet |

No commit, push, merge, deployment, live signup, or AWS resource change was
performed during this verification.
