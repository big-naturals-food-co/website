import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'
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

const owned = { StringEquals: { 'aws:ResourceTag/Project': accessNames.projectTag } }
const creating = { StringEquals: { 'aws:RequestTag/Project': accessNames.projectTag } }

/** Shared by the human operator and main-only GitHub role; cannot edit IAM. */
export function deploymentStatements(project: ProjectConfig): PolicyStatement[] {
  const stack = `arn:aws:cloudformation:${project.region}:${project.account}:stack/${project.stackName}/*`
  return [
    new PolicyStatement({
      sid: 'DeployOnlySiteWithProjectExecutionRole',
      actions: ['cloudformation:CreateChangeSet', 'cloudformation:CreateStack', 'cloudformation:UpdateStack'],
      resources: [stack],
      conditions: { StringEquals: { 'cloudformation:RoleArn': executionRoleArn(project) } },
    }),
    new PolicyStatement({
      sid: 'InspectAndExecuteOnlySiteChanges',
      actions: ['cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents',
        'cloudformation:DescribeStackResources', 'cloudformation:ListStackResources',
        'cloudformation:GetTemplate', 'cloudformation:GetTemplateSummary',
        'cloudformation:ListChangeSets', 'cloudformation:DescribeChangeSet',
        'cloudformation:ExecuteChangeSet', 'cloudformation:DeleteChangeSet',
        'cloudformation:UpdateTerminationProtection', 'cloudformation:TagResource', 'cloudformation:UntagResource'],
      resources: [stack],
    }),
    new PolicyStatement({
      sid: 'NoImportOfExistingResources', effect: Effect.DENY,
      actions: ['cloudformation:CreateChangeSet'], resources: [stack],
      conditions: { Null: { 'cloudformation:ImportResourceTypes': 'false' } },
    }),
    new PolicyStatement({
      sid: 'PassOnlyProjectExecutionRoleToCloudFormation', actions: ['iam:PassRole'],
      resources: [executionRoleArn(project)],
      conditions: { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
    }),
    new PolicyStatement({
      sid: 'InspectSiteBucket', actions: ['s3:ListBucket', 's3:GetBucketLocation'], resources: [siteBucketArn(project)],
    }),
    new PolicyStatement({
      sid: 'PublishSiteWithoutDeletingVersions', actions: ['s3:GetObject', 's3:PutObject'], resources: [`${siteBucketArn(project)}/*`],
    }),
    new PolicyStatement({
      sid: 'InspectAndInvalidateProjectDistribution',
      actions: ['cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
      resources: [`arn:aws:cloudfront::${project.account}:distribution/*`], conditions: owned,
    }),
    new PolicyStatement({
      sid: 'InspectProjectDns', actions: ['route53:GetHostedZone', 'route53:ListResourceRecordSets'],
      resources: [`arn:aws:route53:::hostedzone/${project.hostedZoneId}`],
    }),
  ]
}

/** Used only by CloudFormation, never assumable by the operator or GitHub. */
export function executionStatements(project: ProjectConfig): PolicyStatement[] {
  const cf = `arn:aws:cloudfront::${project.account}`
  const certificate = `arn:aws:acm:${project.region}:${project.account}:certificate/*`
  const zone = `arn:aws:route53:::hostedzone/${project.hostedZoneId}`
  const domains = [project.domainName, ...project.redirectDomainNames]
  return [
    new PolicyStatement({
      sid: 'ManageOnlySiteBucketConfiguration',
      actions: ['s3:CreateBucket', 's3:Get*', 's3:List*', 's3:Put*', 's3:DeleteBucketPolicy'],
      resources: [siteBucketArn(project)],
    }),
    new PolicyStatement({
      sid: 'InspectProjectDns', actions: ['route53:GetHostedZone', 'route53:ListResourceRecordSets'], resources: [zone],
    }),
    new PolicyStatement({
      sid: 'ManageOnlyWebsiteAliases', actions: ['route53:ChangeResourceRecordSets'], resources: [zone],
      conditions: { 'ForAllValues:StringEquals': {
        'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'AAAA'],
        'route53:ChangeResourceRecordSetsNormalizedRecordNames': domains,
      } },
    }),
    new PolicyStatement({
      sid: 'ManageOnlyCertificateValidationRecords', actions: ['route53:ChangeResourceRecordSets'], resources: [zone],
      conditions: {
        'ForAllValues:StringEquals': { 'route53:ChangeResourceRecordSetsRecordTypes': ['CNAME'] },
        'ForAllValues:StringLike': { 'route53:ChangeResourceRecordSetsNormalizedRecordNames': domains.map(domain => `_*.${domain}`) },
      },
    }),
    new PolicyStatement({ sid: 'WaitForDnsChanges', actions: ['route53:GetChange'], resources: ['arn:aws:route53:::change/*'] }),
    new PolicyStatement({
      sid: 'RequestOnlySiteCertificates', actions: ['acm:RequestCertificate'], resources: ['*'],
      conditions: {
        // Certificate creation must also work when CloudFormation applies tags
        // separately. Domain, validation method, and region remain mandatory.
        StringEquals: { 'acm:ValidationMethod': 'DNS', 'aws:RequestedRegion': project.region },
        StringEqualsIfExists: { 'aws:RequestTag/Project': accessNames.projectTag },
        'ForAllValues:StringEquals': { 'acm:DomainNames': domains },
        Null: { 'acm:DomainNames': 'false' },
      },
    }),
    new PolicyStatement({
      sid: 'InspectCertificatesDuringCreation',
      actions: ['acm:DescribeCertificate', 'acm:ListTagsForCertificate'],
      resources: [certificate],
      // CloudFormation reads the certificate before its separately applied tags
      // are visible to IAM. Permit untagged reads, but not other projects' tags.
      conditions: { StringEqualsIfExists: { 'aws:ResourceTag/Project': accessNames.projectTag } },
    }),
    new PolicyStatement({
      sid: 'ManageProjectCertificates',
      actions: ['acm:DeleteCertificate', 'acm:UpdateCertificateOptions', 'acm:AddTagsToCertificate', 'acm:RemoveTagsFromCertificate'],
      resources: [certificate], conditions: owned,
    }),
    new PolicyStatement({
      sid: 'TagProjectCertificates', actions: ['acm:AddTagsToCertificate'], resources: [certificate],
      conditions: { ...creating, StringEqualsIfExists: { 'aws:ResourceTag/Project': accessNames.projectTag } },
    }),
    new PolicyStatement({
      sid: 'CreateProjectCdn', actions: ['cloudfront:CreateDistribution', 'cloudfront:CreateFunction'], resources: ['*'], conditions: creating,
    }),
    new PolicyStatement({
      sid: 'ManageProjectDistribution',
      actions: ['cloudfront:GetDistribution', 'cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:DeleteDistribution', 'cloudfront:ListTagsForResource', 'cloudfront:TagResource', 'cloudfront:UntagResource'],
      resources: [`${cf}:distribution/*`], conditions: owned,
    }),
    new PolicyStatement({
      sid: 'ManageProjectFunctions',
      actions: ['cloudfront:DescribeFunction', 'cloudfront:GetFunction', 'cloudfront:UpdateFunction', 'cloudfront:DeleteFunction', 'cloudfront:PublishFunction', 'cloudfront:ListTagsForResource', 'cloudfront:TagResource', 'cloudfront:UntagResource'],
      resources: [`${cf}:function/*`], conditions: owned,
    }),
    new PolicyStatement({
      sid: 'TagProjectCdn', actions: ['cloudfront:TagResource'], resources: [`${cf}:distribution/*`, `${cf}:function/*`],
      conditions: { ...creating, StringEqualsIfExists: { 'aws:ResourceTag/Project': accessNames.projectTag } },
    }),
    // These CloudFront resource types do not support IAM resource-tag conditions.
    // They are reachable only through the dedicated site stack's execution role.
    new PolicyStatement({
      sid: 'CreateCdnSupportingResources',
      actions: ['cloudfront:CreateCachePolicy', 'cloudfront:CreateResponseHeadersPolicy', 'cloudfront:CreateOriginAccessControl'], resources: ['*'],
    }),
    ...[
      ['cache-policy', ['GetCachePolicy', 'GetCachePolicyConfig', 'UpdateCachePolicy', 'DeleteCachePolicy']],
      ['response-headers-policy', ['GetResponseHeadersPolicy', 'GetResponseHeadersPolicyConfig', 'UpdateResponseHeadersPolicy', 'DeleteResponseHeadersPolicy']],
      ['origin-access-control', ['GetOriginAccessControl', 'UpdateOriginAccessControl', 'DeleteOriginAccessControl']],
    ].map(([type, actions]) => new PolicyStatement({
      actions: (actions as string[]).map(action => `cloudfront:${action}`), resources: [`${cf}:${type}/*`],
    })),
    new PolicyStatement({
      sid: 'DoNotChangeProjectOwnershipTags', effect: Effect.DENY,
      actions: ['cloudfront:TagResource', 'acm:AddTagsToCertificate'], resources: ['*'],
      conditions: {
        Null: { 'aws:RequestTag/Project': 'false' },
        StringNotEquals: { 'aws:RequestTag/Project': accessNames.projectTag },
      },
    }),
    new PolicyStatement({
      sid: 'KeepProjectOwnershipTags', effect: Effect.DENY,
      actions: ['cloudfront:UntagResource', 'acm:RemoveTagsFromCertificate'], resources: ['*'],
      conditions: { 'ForAnyValue:StringEquals': { 'aws:TagKeys': ['Project'] } },
    }),
  ]
}
