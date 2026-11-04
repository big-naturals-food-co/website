# One-time AWS access setup

The IAM access stack can be provisioned directly through the AWS CLI. Manual
Console template upload is not required. Local deployments are permitted when
useful; a local website deployment is not a prerequisite to GitHub deployment.

**Status: applied through the CLI on November 4, 2026.**
`BigNaturalsFoodCoAccess` is `CREATE_COMPLETE`, with termination protection
enabled. The operator user and both roles exist, and their trust policies were
verified. No website resources or DNS records were changed. The instructions
below are for reference or future access-stack updates; no manual upload or
operator sign-in is needed before adding the GitHub workflow.

## One-time CLI bootstrap

Use an administrator session in account `066540957026`. The `default` profile
currently uses root and is reserved for this initial IAM setup. From
`cloud/aws/`, these commands synthesize and apply only `BigNaturalsFoodCoAccess`:

```sh
aws sts get-caller-identity --profile default
npm run synth:access
aws cloudformation deploy \
  --profile default --region us-east-1 \
  --stack-name BigNaturalsFoodCoAccess \
  --template-file cdk.out/access/BigNaturalsFoodCoAccess.template.json \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset
aws cloudformation update-termination-protection \
  --profile default --region us-east-1 \
  --stack-name BigNaturalsFoodCoAccess \
  --enable-termination-protection
```

Before applying, confirm that the identity command reports account
`066540957026`. IAM bootstrap creates the user, roles, and policies below;
it does not upload website files or change DNS. Later changes to this access
stack also require an administrator; the project identities cannot change
their own permissions. There is no need to rerun bootstrap when the deployed
template already matches.

## Human sign-in and GitHub are independent

`big-naturals-food-co-operator` is a human identity for manual project work.
Its optional console password and MFA setup are separate from GitHub. The
bootstrap creates the user without a password or access key, so human sign-in
is not enabled automatically. Configure a console password and enroll MFA when
human access is needed; keep those credentials private. The user can then
change its own password and use browser-based CLI login:

```sh
aws login --profile big-naturals-food-co --region us-east-1
aws sts get-caller-identity --profile big-naturals-food-co
```

The expected ARN is
`arn:aws:iam::066540957026:user/big-naturals-food-co-operator`.

GitHub instead assumes `big-naturals-food-co-github-deploy` using its OIDC
identity and temporary AWS credentials. It does not sign in as the operator,
use the operator's password/access keys, or request an MFA code. Operator
password/MFA enrollment is **not a prerequisite** for the workflow. The role's
OIDC trust is the authentication boundary for CI.

## What the template creates

| Resource | Purpose |
| --- | --- |
| `big-naturals-food-co-operator` IAM user | Human project access; browser sign-in/CLI login and password changes |
| `big-naturals-food-co-github-deploy` role | GitHub Actions deployment from this repository's `main` branch |
| `big-naturals-food-co-cloudformation` role | AWS service role used to create/update the site's resources |
| Project policies | Scope deployment, publication, DNS, and service permissions |

The existing GitHub OIDC provider is imported; no duplicate provider is created.
The repository uses immutable OIDC subjects, verified through GitHub's API:

```text
aud: sts.amazonaws.com
sub: repo:big-naturals-food-co@352593247/website@1446070942:ref:refs/heads/main
```

The trust excludes pull requests, other repositories, other branches, and
GitHub Environment subjects. The workflow must use branch-based OIDC without
an `environment:` setting unless the trust is deliberately revised.

## Permissions and their limits

The operator and GitHub role share a deployment policy. They can create/update
`BigNaturalsFoodCoSite` only while passing the dedicated CloudFormation role,
inspect and execute that stack's changes, publish objects to the specific site
bucket, inspect its DNS zone, and invalidate CloudFront distributions tagged
`Project=BigNaturalsFoodCo`. They cannot delete site objects/versions, delete
the site stack, assume shared bootstrap roles, change IAM permissions, or
update this access stack. Resource imports are explicitly denied.

The CloudFormation service role manages the exact site bucket and hosted zone.
DNS changes allow only apex/www A/AAAA records and underscore-prefixed CNAMEs
for certificate validation; MX/TXT email records are excluded. Certificate
requests are restricted to the site's domain names and DNS validation.
The request may omit the `Project` tag, allowing certificate creation when
CloudFormation applies tags separately; if supplied, it must be
`BigNaturalsFoodCo`. Domain names must be present and requests must target
`us-east-1`. Certificate description and tag reads permit untagged resources
in this account/region because CloudFormation reads immediately during creation,
before separately applied tags are visible to IAM. Reads reject a different
`Project` tag. Certificate modification and deletion still require the project
tag. Distribution/function operations use project-tag restrictions.
Project ownership tags cannot be removed or changed.

**CloudFront scope limitation:** cache policies, response-header policies, and
origin access controls do not support resource-tag conditions. The service
role therefore has their specific create operations and account-scoped resource
type permissions. These are broader than the eventual individual resource
IDs. Only CloudFormation can assume this role; neither the operator nor GitHub
can call those APIs directly. Their CloudFormation access is restricted to the
site stack, with existing-resource imports denied. This is a shared-account
deployment boundary, not the isolation of a separate AWS account. Reassess
these permissions if new resource types are introduced.

The user additionally gets AWS's `SignInLocalDevelopmentAccess` managed policy
for `aws login`, plus read/change-password access for their own IAM identity.
Self-service creation of access keys, users, roles, and policies is not granted.
The Console's account-wide resource lists may show Access Denied; use named
resources and the CLI for project checks instead of adding broad read policies.

## Validation and next step

From `cloud/aws/`, `npm run typecheck`, `npm test`, `npm run synth`, and
`npm run synth:access` validate and regenerate the source-defined templates.
Both templates fit CloudFormation's inline limit. The tests cover OIDC trust,
policy scope, IAM size limits, and the absence of shared bootstrap roles/assets.
AWS Access Analyzer and CloudFormation template validation passed; 23 read-only
IAM simulations verified allowed site operations and denied cross-project,
IAM-privilege, import, and email-DNS operations. GitHub OIDC assumption worked
in the initial deployment attempts. A successful website deployment and optional
operator sign-in still need their own live checks.

After updating IAM, run `AWS_PROFILE=default npm run verify:certificate-access`
from `cloud/aws/` with an administrator session. This read-only check uses AWS
IAM simulation against the deployed execution role. It covers certificate
creation without tags, reads before/after tagging, initial tagging, project-only
updates/deletion, and rejection of other accounts, regions, and projects.
It does not substitute for an actual CloudFormation deployment.

On November 4, run `41908900280` successfully requested and tagged the
certificate, but its immediate `DescribeCertificate` call was denied by the
resource-tag condition. CloudTrail confirms those operations and successful
certificate deletion during rollback. The inspection permission above addresses
that creation-time read; keeping all ACM actions behind existing tags does not.

The IAM stack is ready and the [GitHub workflow](DEPLOYMENT.md) is implemented.
Its role ARN is:

```text
arn:aws:iam::066540957026:role/big-naturals-food-co-github-deploy
```

No account-wide `cdk bootstrap` is needed. The IAM setup does not create a
workflow or publish the website. Local deployment remains available when useful,
but an extra local website rollout is not required before GitHub.

References: [AWS browser-based CLI login policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SignInLocalDevelopmentAccess.html),
[CloudFront IAM action/resource support](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html),
[CloudFormation IAM conditions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html).
