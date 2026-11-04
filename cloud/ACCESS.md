# One-time AWS access setup

The IAM access stack can be provisioned directly through the AWS CLI. Manual
Console template upload is not required. Local deployments are permitted when
useful; a local website deployment is not a prerequisite to GitHub deployment.

**Status: IAM policies updated through the CLI on November 4, 2026.**
The signup permission update is applied: `BigNaturalsFoodCoAccess` reached
`UPDATE_COMPLETE`, and a read-only CDK comparison found no template differences.
The operator and GitHub role share broad asset-management permissions. The
access stack retains termination protection and remains administrator-managed.

## One-time CLI bootstrap

Use an administrator session in account `066540957026`. The `default` profile
currently uses root and is reserved for IAM setup and policy updates. From
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
| `big-naturals-food-co-signup-runtime` role | Lambda-only role reading the two signup SecureStrings and writing its own logs |
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

The operator and GitHub role share the same deployment policy. It grants full
CloudFormation management of `BigNaturalsFoodCoSite` and `BigNaturalsFoodCoSignup`, including deletion and
recovery of a failed initial stack. They can pass only the dedicated project
execution role to CloudFormation; neither identity can edit IAM or deploy the
access stack.

Both deployment identities and the CloudFormation execution role have:

| Service | Permissions and scope |
| --- | --- |
| S3 | `s3:*` on the named site bucket and all objects/versions within it |
| Route 53 | `route53:*` on the site's hosted zone and change records |
| CloudFront | `cloudfront:*` on this account's resources, plus creation/listing APIs |
| ACM | `acm:*` on this account's certificates in `us-east-1`, plus certificate requests/listing in that region |
| Lambda | Management of only `big-naturals-food-co-signup`; pass only its runtime role to Lambda |
| CloudWatch Logs | Lifecycle/retention/tag operations for the signup log group; region-wide log-group listing |
| API Gateway | API management in this region and domain creation/listing; existing custom-domain and certificate management only for the site's `api` hostname |

There are no request-tag, existing-tag, record-type, or per-operation restrictions
on those assets. Tags remain useful metadata, not deployment authorization gates.
CloudFront and ACM management extends to other resources in the same account
(and ACM region); Route 53 access covers all records in the site's zone. This
is the deliberately broader policy requested for deployment reliability.
The stacks declare website/API aliases and their certificate validation
records, and publication still retains old files and versions.

The user additionally gets AWS's `SignInLocalDevelopmentAccess` managed policy
for `aws login`, plus read/change-password access for their own IAM identity.
The GitHub deployment role alone can write the two project signup SSM parameters. The Lambda
runtime alone has direct secret-read permission; GitHub and CloudFormation do
not. Deployment access can indirectly use those secrets by modifying Lambda
code, so keep the main-branch trust boundary intact. See [SIGNUP.md](SIGNUP.md).
Self-service creation of access keys, users, roles, and policies is not granted.
The Console's account-wide resource lists may show Access Denied; use named
resources and the CLI for project checks instead of adding broad read policies.

## Validation and next step

From `cloud/aws/`, `npm run typecheck`, `npm test`, `npm run synth`, and
`npm run synth:access` validate and regenerate the source-defined templates.
All templates fit CloudFormation's inline limit. The tests cover OIDC trust,
policy scope, IAM size limits, and the absence of shared bootstrap roles/assets.
On November 4, 2026, the project operator successfully recovered the failed
initial stack, deployed the full site, published 11 files, completed CloudFront
invalidation, and passed public HTTPS/build/redirect verification. This exercised
the same managed deployment policy used by GitHub. An administrator created a
one-use operator access key for the local run; it stayed in process memory and
was deleted after verification. No persistent key or profile was installed.

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
