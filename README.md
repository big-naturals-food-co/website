# Big Naturals Food Co.

A single static landing page built with Nuxt, TypeScript, and Tailwind CSS.

Web setup, local preview, build commands, and verification notes are in
[`web/README.md`](web/README.md).

## Initial sprint

1. **Landing page (implemented):** Nuxt and Tailwind, responsive coming-soon content, metadata,
   and favicon. Provisional cream/red branding; final copy and branding can be
   supplied later.
2. **AWS infrastructure:** TypeScript CDK in `cloud/aws/`, private S3, CloudFront
   with Origin Access Control, Route 53, and a DNS-validated ACM certificate.
   Redirect unknown page URLs to `/` while serving assets normally; no dedicated
   404 page. Use versioned/retained storage. Confirm the domain, AWS account, and
   hosted zone before implementation. Prepare initial CDK bootstrap and GitHub
   OIDC role setup through AWS Console/CloudShell.
3. **GitHub deployments:** on pushes to `main`, validate and generate the site,
   deploy CDK, upload assets, and invalidate CloudFront. Authenticate through
   OIDC restricted to this repository's `main` branch. Serialize deployments
   and document verification and rollback.

One production environment. No beta branch, release-triggered deployments, or
local deployments. URL redirects are a CloudFront responsibility in step 2;
the static build alone does not implement those redirects.

## After the initial sprint

Add email signups similar to Waller Creek High: an accessible signup form,
consent and bot protection, and the supporting backend/provider integration.
This is deliberately deferred until the static site and deployment workflow
are complete.
