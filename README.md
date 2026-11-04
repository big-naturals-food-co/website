# Big Naturals Food Co.

A single static landing page built with Nuxt, TypeScript, and Tailwind CSS.

Web setup, local preview, build commands, and verification notes are in
[`web/README.md`](web/README.md).

## Initial sprint

1. **Landing page (implemented):** Nuxt and Tailwind, responsive coming-soon content, metadata,
   and favicon. Provisional cream/red branding; final copy and branding can be
   supplied later.
2. **Site infrastructure (code implemented; not deployed):** TypeScript CDK in `cloud/aws/`, private S3, CloudFront
   with Origin Access Control, Route 53, and a DNS-validated ACM certificate.
   Redirect unknown page URLs to `/` while serving assets normally; no dedicated
   404 page. Versioned/retained storage. The account and existing hosted zone
   for `bignaturalsfoodco.com` are verified. Dedicated IAM access was created
   through the [one-time CLI setup](cloud/ACCESS.md); GitHub can use its OIDC role
   independently of the human operator's login.
   See [`cloud/README.md`](cloud/README.md) for configuration and validation.
3. **GitHub deployments:** on pushes to `main`, validate and generate the site,
   deploy CDK, upload assets, and invalidate CloudFront. Authenticate through
   OIDC restricted to this repository's `main` branch. Serialize deployments
   and document verification and rollback.

One production environment. No beta branch or release-triggered deployments.
Local deployment is allowed when useful; it is not an extra required step before
GitHub deployment. URL redirects are a CloudFront responsibility in step 2;
the static build alone does not implement those redirects.

## After the initial sprint

Add email signups similar to Waller Creek High: an accessible signup form,
consent and bot protection, and the supporting backend/provider integration.
This is deliberately deferred until the static site and deployment workflow
are complete.
