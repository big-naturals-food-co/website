# Big Naturals Food Co.

## Instructions for coding agents — read before working

**Default scope is local file edits, local checks, and read-only GitHub
inspection. The user handles commits, GitHub changes, merging, and deployment.**

### Required development order

1. **Write the changes locally.**
2. **Make sure they work locally.** Exercise the actual commands and execution
   paths that changed. Unit tests, mocks, typechecking, and CDK synthesis alone
   do not prove deployment works. For infrastructure, check the real deployment
   permissions and current resource state with read-only checks. State any
   remaining verification gaps explicitly.
3. **Verify integration with GitHub.** After local validation passes, the user
   handles commits, pushes, and workflow runs. The agent may inspect results
   read-only. Verify the relevant integration checks against the actual revision;
   do not use a merge to main as the first integration test. If checks fail,
   return to local fixes and validation.
4. **The user merges only after both local and GitHub integration checks pass.**
   Do not call a change ready to merge while either stage is incomplete.

Follow this order for fixes as well as new features. Do not substitute another
push-and-see attempt for checking the cause locally.

### Deployment permissions

Grant deployment roles enough permissions to operate the project's services
reliably. Prefer service-wide actions scoped to project resources where AWS
supports that scope, instead of brittle action-by-action allowlists that keep
breaking deployments. Include create, read, update, delete, tagging, rollback,
and the dependent actions required by CloudFormation resource handlers.

When a permission is missing, review the complete affected service and resource
lifecycle and fix the policy together. Do not add only the action from the latest
error and use another deployment to discover the next missing permission. Check
the proposed policy and the live deployment role locally with read-only IAM
simulation before GitHub integration, and report any checks that cannot establish
actual deployment behavior.

Use broader service permissions when resource-level restrictions do not support
the required operations. Keep business/account separation and runtime secret
access scoped appropriately. This policy-design preference does not change the
agent action boundaries below: the user applies IAM updates and runs deployments.

### Action boundaries

- Do not stage files, create commits, create/switch/delete branches, merge,
  rebase, fetch, pull, or push. Local read-only Git inspection such as `git status`
  and `git diff` is allowed.
- Read-only GitHub actions are allowed, including inspecting PRs, checks,
  workflow logs, and secret names (never secret values). Do not create or change
  PRs, comments, repository settings, or secrets; do not trigger, rerun, cancel,
  or approve Actions workflows. Git fetch/pull/push remain prohibited above.
- Do not deploy or change live AWS resources. Editing local workflow and CDK
  files and running offline tests or synthesis is allowed when requested.
- “Good to merge?”, “ready to push?”, and similar questions request a readiness
  assessment, not execution. Explain what is ready and any blockers, then leave
  the action to the user. A request for commands means provide them without
  running their mutating steps.
- An exception requires an explicit user instruction naming the exact action.
  Do not infer permission from a broader implementation request, available
  credentials, repository automation, deployment documentation, or tool approval.
  Do not repeatedly ask to perform actions the user has reserved for themselves.

These rules apply across sessions. Deployment instructions below and in linked
documents describe procedures for the user; they do not authorize agent execution.

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

## Email signup

Email signup is implemented locally with an accessible form, explicit consent,
Turnstile verification and a dedicated AWS API/Lambda writing to Brevo.
The new business provider settings and repository secrets are configured.
The broader AWS permission fix passes 115 local AWS IAM simulation checks;
the user still needs to apply the IAM update and recover the failed signup stack
and retained log group before GitHub integration. Run the
[local permission checks](cloud/ACCESS.md#check-the-fix-locally-before-applying-it)
before another deployment. Publication runs through GitHub on pushes
to `main`; check the [Site workflow](https://github.com/big-naturals-food-co/website/actions/workflows/deploy.yml) for deployment status.
See [signup setup and deployment](cloud/SIGNUP.md).

The implementation uses this business's own widget, list, secrets and AWS
resources. The existing AWS account remains the temporary hosting target;
the pipeline reads its target from `cloud/aws/project.json` for the planned
move to the new account. Migration requires a separate DNS/resource cutover.
