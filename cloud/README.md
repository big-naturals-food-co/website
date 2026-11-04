# Big Naturals Food Co. infrastructure

The TypeScript CDK application in `aws/` defines one production static site.
The infrastructure code is implemented and validated; it has **not been
deployed**. Project-specific IAM access is deployed. The GitHub workflow is
implemented; its first rollout is pending. See [deployment and rollback](DEPLOYMENT.md).
There is no beta environment or application backend.

## Configuration

Non-secret production settings live in [`aws/project.json`](aws/project.json).

| Setting | Value |
| --- | --- |
| AWS account | `066540957026` |
| Region | `us-east-1` |
| Canonical site | `https://bignaturalsfoodco.com` |
| Redirect host | `www.bignaturalsfoodco.com` |
| Existing public hosted zone | `Z06575272C3P2P6HNST09` |
| Stack | `BigNaturalsFoodCoSite` |
| Site bucket | `big-naturals-food-co-site-066540957026-us-east-1` |

The region is deliberately fixed to `us-east-1` so the certificate and site
can live in a single stack. CloudFront requires its viewer certificate there.
[AWS certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html)

The existing hosted zone is imported by ID, without an AWS lookup during
synthesis. The stack owns the apex/www A and AAAA aliases and certificate
validation records. It does not create a hosted zone, transfer the domain, or
manage email records.

Read-only verification on November 4, 2026 confirmed the account and public
zone. The zone has Google mail/verification records and no conflicting apex or
www website records. The account already has `CDKToolkit` (bootstrap version
32) and the GitHub OIDC provider. None of those resources was modified.

## Local validation only

Use Node 24.15 or newer within Node 24. From `cloud/aws/`:

```sh
npm ci
npm run typecheck
npm test
npm run synth
```

These commands do not deploy, upload files, invalidate caches, or change DNS.
They need no AWS credentials. The generated production template is
`aws/cdk.out/BigNaturalsFoodCoSite.template.json`; generated assemblies are
ignored by Git. `npm run synth:example` validates the same infrastructure with
the example account/domain in `project.example.json` and writes to
`aws/cdk.out/example/`.

## Resources and request behavior

The stack creates a private, encrypted, versioned S3 bucket with public access
blocked and ACLs disabled. Its policy requires HTTPS and grants reads to only
this CloudFront distribution through Origin Access Control. Objects and their
versions are retained if the bucket is removed from the stack; there are no
automatic deletion or expiration rules. The stack has termination protection.
[CDK Origin Access Control](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins-readme.html)

CloudFront serves `index.html` for `/`, redirects HTTP to HTTPS, and provides
compression and security headers. The CDN uses North America/Europe price
class 100, while remaining accessible globally. The default cache lifetime is
five minutes; S3 `Cache-Control` metadata can set lifetimes from zero through
one year. Query strings and cookies are excluded from the cache key because
this sprint's content is static.

The viewer-request function applies these rules before an S3 request:

| Request | Result |
| --- | --- |
| Canonical `/` | Serve the landing page |
| `/_nuxt/*`, `/favicon.svg`, `/_payload.json` | Serve the asset normally |
| Any other path, including `/index.html` and `/404.html` | 302 redirect to `/` |
| `www` or the distribution hostname | Redirect to the canonical host, preserving recognized asset paths |

Redirects preserve query parameters, including repeated parameters, and are
cached for five minutes. The redirects are temporary so future pages can be
introduced without persistent browser redirects. There is no custom 404 page
or HTML error fallback. Missing files within the reserved `/_nuxt/` asset
namespace remain asset errors rather than receiving HTML in place of JS/CSS.
Extend the asset allowlist in `lib/landing-request.ts` when adding public files.

## Access and first deployment handoff

The separate `BigNaturalsFoodCoAccess` stack was deployed through the CLI on
November 4, 2026. It is `CREATE_COMPLETE` with termination protection enabled.
The root `default` profile was used for this one-time IAM bootstrap, which
created the operator user, main-only GitHub role, and CloudFormation service
role. The website and DNS were not deployed. See [CLI setup and authentication
details](ACCESS.md); operator password/MFA setup is independent of GitHub and
is not a workflow prerequisite.

The site assembly now passes only the dedicated project service role to
CloudFormation. It uses the caller's deployment credentials directly, with no
shared CDK roles, bootstrap bucket, ECR repository, SSM bootstrap lookup, or
asset uploads. The custom static synthesizer rejects file/Docker assets and
templates over CloudFormation's 51,200-byte inline limit. Website publication
remains a separate workflow step.

The existing account bootstrap and OIDC provider are left unchanged. The
GitHub role imports the provider and uses the repository's verified immutable
OIDC subject, including owner/repository IDs and `refs/heads/main`. The access
stack is maintained through the CLI by an administrator; the operator and
GitHub role can deploy only the site stack and cannot edit their own IAM access.
See [permissions and their limits](ACCESS.md#permissions-and-their-limits).

The site stack creates DNS aliases, so its first deployment must be followed
by publication of the generated site files in the same workflow. An empty
bucket cannot serve the landing page. Step 3 should upload hashed assets first,
publish HTML and mutable Nuxt build metadata with short cache lifetimes, retain
old hashed assets for existing clients, and invalidate changed entrypoints.
Keep mutable `/_nuxt/builds/latest.json` out of the immutable asset cache group.

Stack outputs expose the site URL, bucket name, distribution ID/ARN/domain, and
certificate ARN for the workflow. Site uploads should use those outputs rather
than guessed CloudFront IDs. Infrastructure deployment does not upload the
web files or introduce a Lambda-backed bucket-deployment custom resource.

## Verification

Typechecking, eighteen tests, and synthesis for the access stack plus production and example site settings
passed on November 4, 2026. Tests check private bucket permissions/retention,
certificate validation and DNS aliases, HTTPS and edge-function wiring,
canonical/unknown-path redirects, asset pass-through, query preservation, and
configuration validation. IAM stack creation and live role trust checks passed;
website HTTPS and GitHub OIDC checks remain pending the workflow deployment.
AWS Access Analyzer accepted both
proposed deployment/execution policies; AWS validated the setup template, and
23 read-only IAM simulation cases passed. These checks do not replace a real
deployment or verification using the new identity.

`npm audit` reports two moderate affected packages (`aws-cdk-lib` and its
transitive `minimatch` dependency) for one glob-processing denial-of-service
advisory; no high or critical findings. The proposed automatic fix downgrades
CDK and has not been applied. This tooling runs during infrastructure builds
and is not included in the public website.
