import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import type { ProjectConfig } from './config.js'

export const accessNames = {
  stack: 'BigNaturalsFoodCoAccess',
  operator: 'big-naturals-food-co-operator',
  githubRole: 'big-naturals-food-co-github-deploy',
  executionRole: 'big-naturals-food-co-cloudformation',
  // Verified against this repository's immutable OIDC subject configuration.
  githubSubject: 'repo:big-naturals-food-co@352593247/website@1446070942:ref:refs/heads/main',
  projectTag: 'BigNaturalsFoodCo',
}

export const executionRoleArn = (project: ProjectConfig) =>
  `arn:aws:iam::${project.account}:role/${accessNames.executionRole}`

export const siteBucketArn = (project: ProjectConfig) =>
  `arn:aws:s3:::big-naturals-food-co-site-${project.account}-${project.region}`

/** Shared by the human operator and main-only GitHub role. */
export function deploymentStatements(project: ProjectConfig): PolicyStatement[] {
  return [
    new PolicyStatement({
      sid: 'ManageSiteStack', actions: ['cloudformation:*'],
      resources: [`arn:aws:cloudformation:${project.region}:${project.account}:stack/${project.stackName}/*`],
    }),
    new PolicyStatement({
      sid: 'PassOnlyProjectExecutionRoleToCloudFormation', actions: ['iam:PassRole'],
      resources: [executionRoleArn(project)],
      conditions: { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
    }),
    ...executionStatements(project),
  ]
}

/** Full service management for site resources, without tag-dependent checks. */
export function executionStatements(project: ProjectConfig): PolicyStatement[] {
  return [
    new PolicyStatement({
      sid: 'ManageSiteBucket', actions: ['s3:*'],
      resources: [siteBucketArn(project), `${siteBucketArn(project)}/*`],
    }),
    new PolicyStatement({
      sid: 'ManageSiteDns', actions: ['route53:*'],
      resources: [`arn:aws:route53:::hostedzone/${project.hostedZoneId}`, 'arn:aws:route53:::change/*'],
    }),
    new PolicyStatement({
      sid: 'ManageCdn', actions: ['cloudfront:*'],
      resources: [`arn:aws:cloudfront::${project.account}:*`],
    }),
    // Creation/list APIs have no resource ARN to scope before creation.
    new PolicyStatement({
      sid: 'CreateAndListCdn', actions: ['cloudfront:Create*', 'cloudfront:List*'], resources: ['*'],
    }),
    new PolicyStatement({
      sid: 'ManageCertificates', actions: ['acm:*'],
      resources: [`arn:aws:acm:${project.region}:${project.account}:certificate/*`],
    }),
    new PolicyStatement({
      sid: 'RequestAndListCertificates', actions: ['acm:RequestCertificate', 'acm:ListCertificates'], resources: ['*'],
      conditions: { StringEquals: { 'aws:RequestedRegion': project.region } },
    }),
  ]
}
