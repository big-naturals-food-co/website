# Big Naturals Food Co.

A single static landing page built with Nuxt, TypeScript, and Tailwind CSS.
Live at [bignaturalsfoodco.com](https://bignaturalsfoodco.com).

Web setup, local preview, build commands, and verification notes are in
[`web/README.md`](web/README.md).

## Initial sprint

1. **Landing page (implemented):** Nuxt and Tailwind, responsive coming-soon content, metadata,
   and favicon. Provisional cream/red branding; final copy and branding can be
   supplied later.
2. **Site infrastructure (deployed and verified locally):** TypeScript CDK in `cloud/aws/`, private S3, CloudFront
   with Origin Access Control, Route 53, and a DNS-validated ACM certificate.
   Redirect unknown page URLs to `/` while serving assets normally; no dedicated
   404 page. Versioned/retained storage. The account and existing hosted zone
   for `bignaturalsfoodco.com` are verified. Dedicated IAM access was created
   through the [one-time CLI setup](cloud/ACCESS.md); GitHub can use its OIDC role
   independently of the human operator's login.
   See [`cloud/README.md`](cloud/README.md) for configuration and validation.
3. **GitHub deployments (implemented; local rollout verified):** on pushes to `main`, validate and generate the site,
   deploy CDK, upload assets, and invalidate CloudFront. Authenticate through
   OIDC restricted to this repository's `main` branch. Serialize deployments
   and verify the published build. See [deployment and rollback](cloud/DEPLOYMENT.md).

One production environment. No beta branch or release-triggered deployments.
The first successful production rollout was deployed locally on November 4,
2026 using the operator with the same managed deployment policy as GitHub.
Infrastructure creation, file publication, cache invalidation, and HTTPS checks
passed; GitHub has not been rerun since that local verification. URL redirects are a CloudFront responsibility in step 2;
the static build alone does not implement those redirects.

## After the initial sprint

Add email signups similar to Waller Creek High: an accessible signup form,
consent and bot protection, and the supporting backend/provider integration.
This is deliberately deferred until the static site and deployment workflow
are complete.
