# GitHub deployments

The [Site workflow](../.github/workflows/deploy.yml) checks pull requests and
deploys production on pushes to `main`. There is no beta, release trigger,
manual dispatch, or GitHub Environment. IAM trusts the exact immutable
repository/main OIDC subject documented in [ACCESS.md](ACCESS.md).

## How a deployment runs

1. Install locked dependencies with Node 24. Typecheck and test infrastructure
   and publication code, synthesize both CDK apps, and typecheck/generate Nuxt.
   Validate the publication file list without AWS credentials.
2. For a main push, save the generated site as a seven-day Actions artifact.
   The deployment job checks out the same commit and downloads that exact site
   build. Pull requests run checks only and never obtain AWS credentials.
3. Reject an outdated main run, obtain temporary credentials through OIDC, and
   deploy only `BigNaturalsFoodCoSite` using its dedicated CloudFormation role.
   The IAM access stack remains administrator-managed and is never deployed
   by this workflow.
4. Upload immutable Nuxt assets first, followed by short-lived files, HTML, and
   the mutable latest-build marker. Retain old files and versions. Invalidate
   CloudFront and wait for completion.
5. Verify HTTPS: the public homepage and referenced CSS/JS/favicon must exactly
   match the build artifact, and unknown page URLs plus `www` must redirect to
   the canonical root. Retry briefly for initial DNS/cache propagation.

The workflow serializes runs for each ref without cancelling an active
deployment. GitHub may replace a pending run with a newer push; the main-tip
check prevents an old rerun from publishing over newer code. All third-party
Actions are pinned to reviewed release commit SHAs. No AWS secrets or repository
variables need to be entered: the non-secret account, region, and role ARN are
already configured. The expected AWS account is checked during authentication
and again before site upload; publication rejects root credentials.

## Normal use

Open a PR to `main` and let **Build and check** pass. This repository requires
pull requests and squash merges. Merging pushes the resulting commit to `main`
and starts **Deploy production**. The first rollout creates the bucket, CDN,
certificate, and DNS aliases, then publishes the landing page. Between initial
DNS creation and the first upload, the empty bucket cannot serve the page.

The role's one-hour session covers a deployment job with a 60-minute timeout.
Certificate or CloudFront provisioning can take several minutes. Check the
Actions log and CloudFormation events if the initial rollout stalls or fails.
Do not widen IAM policies without identifying the missing operation/resource.

## Failure and rollback

If checks fail, nothing is deployed. A failure during CDK deployment leaves
CloudFormation responsible for its rollback; the workflow does not publish
files afterward. A failed upload can leave partial files, so rerun the latest
main workflow after correcting the cause. Uploads overwrite matching keys but
never delete old assets or versions. The site can already be live if the final
verification step fails; inspect the failed assertion before assuming rollback.

For a frontend rollback, restore `web/` from a known-good commit in a new PR,
preserving the current workflow and infrastructure. Merge that PR to publish
the restored site through the normal main workflow. Do not rerun an old
commit's deployment: the main-tip guard deliberately rejects it. Infrastructure
rollback needs review of the resource changes; do not delete the retained
bucket or IAM access stack as a recovery shortcut.

## Local validation and optional manual use

From `cloud/aws/`, run `npm run typecheck`, `npm test`, and `npm run synth`.
From `web/`, run `npm run typecheck` and `npm run generate`. Then, from
`cloud/aws/`:

```sh
npm run publish:site -- --dry-run
```

That command validates the generated files and prints their upload/cache order;
it never calls AWS. `npm run verify:site` makes public read-only HTTPS requests
and compares against the local generated build, so use the matching Actions
artifact for verification of a deployed revision. A newly generated local build
may have different Nuxt build IDs even at the same source commit.

Local deployment is allowed when useful but is not a prerequisite to GitHub
deployment. For an explicitly requested manual rollout, use the operator's
credentials and the same CDK/publishing commands as the workflow. Keep the
generated `cdk.out/deploy-outputs.json` local; it supplies the validated bucket,
distribution ID, and canonical URL to `npm run publish:site -- --outputs ...`.

When adding public files, update both the edge routing allowlist and publication
validation/content types. HTML, payloads, favicon, and Nuxt build metadata use
five-minute caches. Other `/_nuxt/` assets use one-year immutable caches.
