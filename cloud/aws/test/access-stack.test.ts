import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { App } from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import type { AwsCloudFormationStackProperties } from 'aws-cdk-lib/cloud-assembly-schema'
import { AccessStack } from '../lib/access-stack.js'
import { accessNames, deploymentStatements, executionRoleArn, executionStatements, siteBucketArn } from '../lib/access.js'
import { parseProjectConfig } from '../lib/config.js'
import { SiteStack } from '../lib/site-stack.js'
import { StaticSynthesizer } from '../lib/static-synthesizer.js'

const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.example.json', import.meta.url), 'utf8')))

test('access bootstrap creates only IAM, imports OIDC, and contains no passwords or keys', () => {
  const template = Template.fromStack(new AccessStack(new App(), accessNames.stack, { project }))
  template.resourceCountIs('AWS::IAM::User', 1)
  template.resourceCountIs('AWS::IAM::Role', 2)
  for (const type of ['AWS::IAM::AccessKey', 'AWS::IAM::OIDCProvider', 'AWS::S3::Bucket', 'AWS::Route53::RecordSet', 'AWS::CloudFront::Distribution']) {
    template.resourceCountIs(type, 0)
  }
  template.hasResourceProperties('AWS::IAM::User', {
    UserName: accessNames.operator,
    LoginProfile: Match.absent(),
    ManagedPolicyArns: Match.arrayWith([Match.objectLike({ 'Fn::Join': Match.anyValue() })]),
  })
  for (const resource of Object.values(template.toJSON().Resources) as { Type: string }[]) {
    assert.ok(resource.Type.startsWith('AWS::IAM::') || resource.Type === 'AWS::CDK::Metadata')
  }
})

test('GitHub trust requires exact repository/main and audience; execution role trusts only CloudFormation', () => {
  const template = Template.fromStack(new AccessStack(new App(), accessNames.stack, { project }))
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: accessNames.githubRole,
    AssumeRolePolicyDocument: {
      Version: '2012-10-17', Statement: [{
        Action: 'sts:AssumeRoleWithWebIdentity', Effect: 'Allow',
        Principal: { Federated: `arn:aws:iam::${project.account}:oidc-provider/token.actions.githubusercontent.com` },
        Condition: { StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': accessNames.githubSubject,
        } },
      }],
    },
  })
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: accessNames.executionRole,
    AssumeRolePolicyDocument: {
      Version: '2012-10-17', Statement: [{
        Action: 'sts:AssumeRole', Effect: 'Allow', Principal: { Service: 'cloudformation.amazonaws.com' },
      }],
    },
  })
})

test('deployment policy cannot alter IAM, use shared bootstrap roles, or manage other stacks', () => {
  const statements = deploymentStatements(project).map(s => s.toStatementJson())
  const text = JSON.stringify(statements)
  assert.ok(!text.includes('hnb659fds'))
  const iamActions = statements.flatMap(s => [s.Action].flat()).filter((a: string) => a.startsWith('iam:'))
  assert.deepEqual(iamActions, ['iam:PassRole'])
  const pass = statements.find(s => s.Sid === 'PassOnlyProjectExecutionRoleToCloudFormation')!
  assert.equal(pass.Resource, executionRoleArn(project))
  assert.equal(pass.Condition.StringEquals['iam:PassedToService'], 'cloudformation.amazonaws.com')
  for (const statement of statements.filter(s => [s.Action].flat().some((a: string) => a.startsWith('cloudformation:')))) {
    assert.equal(statement.Resource, `arn:aws:cloudformation:${project.region}:${project.account}:stack/${project.stackName}/*`)
  }
  assert.ok(!text.includes('cloudformation:DeleteStack'))
  assert.ok(!text.includes('s3:DeleteObject'))
  assert.equal(statements.find(s => s.Sid === 'PublishSiteWithoutDeletingVersions')!.Resource, `${siteBucketArn(project)}/*`)
  assert.equal(statements.find(s => s.Sid === 'NoImportOfExistingResources')!.Effect, 'Deny')
  assert.ok(JSON.stringify({ Version: '2012-10-17', Statement: statements }).length < 6144)
})

test('execution scope excludes IAM and email DNS, retains ownership tags, and fits IAM size limits', () => {
  const statements = executionStatements(project).map(s => s.toStatementJson())
  const text = JSON.stringify(statements)
  assert.ok(!text.includes('iam:'))
  assert.ok(!text.includes('sts:AssumeRole'))
  const dns = statements.filter(s => [s.Action].flat().includes('route53:ChangeResourceRecordSets'))
  assert.equal(dns.length, 2)
  for (const statement of dns) {
    assert.equal(statement.Resource, `arn:aws:route53:::hostedzone/${project.hostedZoneId}`)
    const types = statement.Condition['ForAllValues:StringEquals']['route53:ChangeResourceRecordSetsRecordTypes']
    assert.ok(types.every((type: string) => ['A', 'AAAA', 'CNAME'].includes(type)))
  }
  assert.equal(statements.find(s => s.Sid === 'KeepProjectOwnershipTags')!.Effect, 'Deny')
  assert.equal(statements.find(s => s.Sid === 'DoNotChangeProjectOwnershipTags')!.Effect, 'Deny')
  assert.ok(JSON.stringify({ Version: '2012-10-17', Statement: statements }).length < 10_240)
})

test('certificate creation permits deferred tagging without relaxing domain, DNS, or region restrictions', () => {
  const statements = executionStatements(project).map(s => s.toStatementJson())
  const request = statements.find(s => s.Sid === 'RequestOnlySiteCertificates')!
  assert.deepEqual(request.Condition, {
    StringEquals: { 'acm:ValidationMethod': 'DNS', 'aws:RequestedRegion': project.region },
    StringEqualsIfExists: { 'aws:RequestTag/Project': accessNames.projectTag },
    'ForAllValues:StringEquals': { 'acm:DomainNames': [project.domainName, ...project.redirectDomainNames] },
    Null: { 'acm:DomainNames': 'false' },
  })
  const management = statements.find(s => s.Sid === 'ManageProjectCertificates')!
  assert.equal(management.Condition.StringEquals['aws:ResourceTag/Project'], accessNames.projectTag)
})

test('assemblies use caller credentials and only the project service role, without bootstrap assets', () => {
  const app = new App()
  new SiteStack(app, project.stackName, { project })
  new AccessStack(app, accessNames.stack, { project })
  const assembly = app.synth()
  const site = assembly.manifest.artifacts![project.stackName]!.properties! as AwsCloudFormationStackProperties
  const access = assembly.manifest.artifacts![accessNames.stack]!.properties! as AwsCloudFormationStackProperties
  assert.equal(site.cloudFormationExecutionRoleArn, executionRoleArn(project))
  assert.equal(access.cloudFormationExecutionRoleArn, undefined)
  for (const artifact of [site, access]) {
    assert.equal(artifact.assumeRoleArn, undefined)
    assert.equal(artifact.requiresBootstrapStackVersion, undefined)
    assert.equal(artifact.lookupRole, undefined)
    assert.equal(artifact.stackTemplateAssetObjectUrl, undefined)
  }
  assert.ok(Object.values(assembly.manifest.artifacts!).every(a => a.type !== 'cdk:asset-manifest'))
  for (const stack of assembly.stacks) {
    assert.ok(readFileSync(stack.templateFullPath).byteLength <= 51_200)
  }
})

test('static synthesizer rejects file and Docker assets before permissions silently expand', () => {
  const synth = new StaticSynthesizer()
  assert.throws(() => synth.addFileAsset({ sourceHash: 'test', fileName: 'asset.txt' }), /no CDK file assets/)
  assert.throws(() => synth.addDockerImageAsset({ sourceHash: 'test', directoryName: 'image' }), /no Docker assets/)
})
