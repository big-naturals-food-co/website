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
import { signupNames, parseSignupConfig } from '../lib/signup-config.js'
import { SignupStack } from '../lib/signup-stack.js'
import { StaticSynthesizer } from '../lib/static-synthesizer.js'

const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.example.json', import.meta.url), 'utf8')))

test('access bootstrap creates only IAM, imports OIDC, and contains no passwords or keys', () => {
  const template = Template.fromStack(new AccessStack(new App(), accessNames.stack, { project }))
  template.resourceCountIs('AWS::IAM::User', 1)
  template.resourceCountIs('AWS::IAM::Role', 3)
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
  assert.deepEqual(iamActions, ['iam:PassRole', 'iam:PassRole'])
  assert.ok(!text.includes('ssm:'))
  const pass = statements.find(s => s.Sid === 'PassOnlyProjectExecutionRoleToCloudFormation')!
  assert.equal(pass.Resource, executionRoleArn(project))
  assert.equal(pass.Condition.StringEquals['iam:PassedToService'], 'cloudformation.amazonaws.com')
  for (const statement of statements.filter(s => [s.Action].flat().some((a: string) => a.startsWith('cloudformation:')))) {
    assert.deepEqual(statement.Resource, [project.stackName, signupNames.stack].map(name => `arn:aws:cloudformation:${project.region}:${project.account}:stack/${name}/*`))
  }
  assert.equal(statements.find(s => s.Sid === 'ManageSiteStack')!.Action, 'cloudformation:*')
  assert.ok(JSON.stringify({ Version: '2012-10-17', Statement: statements }).length < 6144)
})

test('asset policies grant full service management with bucket, zone, account and region boundaries', () => {
  const statements = executionStatements(project).map(s => s.toStatementJson())
  const text = JSON.stringify(statements)
  assert.deepEqual(statements.flatMap(s => [s.Action].flat()).filter((a: string) => a.startsWith('iam:')), ['iam:PassRole'])
  assert.ok(!text.includes('sts:'))
  assert.ok(!text.includes('aws:ResourceTag'))
  assert.ok(!text.includes('aws:RequestTag'))
  const byId = (sid: string) => statements.find(s => s.Sid === sid)!
  assert.equal(byId('ManageSiteBucket').Action, 's3:*')
  assert.deepEqual(byId('ManageSiteBucket').Resource, [siteBucketArn(project), `${siteBucketArn(project)}/*`])
  assert.equal(byId('ManageSiteDns').Action, 'route53:*')
  assert.deepEqual(byId('ManageSiteDns').Resource, [`arn:aws:route53:::hostedzone/${project.hostedZoneId}`, 'arn:aws:route53:::change/*'])
  assert.equal(byId('ManageCdn').Action, 'cloudfront:*')
  assert.equal(byId('ManageCdn').Resource, `arn:aws:cloudfront::${project.account}:*`)
  assert.equal(byId('ManageCertificates').Action, 'acm:*')
  assert.equal(byId('ManageCertificates').Resource, `arn:aws:acm:${project.region}:${project.account}:certificate/*`)
  assert.ok(JSON.stringify({ Version: '2012-10-17', Statement: statements }).length < 10_240)
})

test('assemblies use caller credentials and only the project service role, without bootstrap assets', () => {
  const app = new App()
  new SiteStack(app, project.stackName, { project })
  new AccessStack(app, accessNames.stack, { project })
  new SignupStack(app, signupNames.stack, { project, signup: parseSignupConfig({ enabled: false, brevoListId: null, turnstileSiteKey: '' }) })
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

test('only GitHub gets direct write access to the two signup secrets', () => {
  const template = Template.fromStack(new AccessStack(new App(), accessNames.stack, { project }))
  const resources = template.toJSON().Resources as Record<string, any>
  const github = Object.entries(resources).find(([, resource]) => resource.Type === 'AWS::IAM::Role' && resource.Properties.RoleName === accessNames.githubRole)![0]
  const writers = Object.values(resources).filter(resource => resource.Type === 'AWS::IAM::Policy'
    && resource.Properties.PolicyDocument.Statement.some((statement: any) => [statement.Action].flat().includes('ssm:PutParameter')))
  assert.equal(writers.length, 1)
  assert.deepEqual(writers[0].Properties.Roles, [{ Ref: github }])
  const statement = writers[0].Properties.PolicyDocument.Statement.find((statement: any) => [statement.Action].flat().includes('ssm:PutParameter'))
  assert.deepEqual(statement.Resource, [signupNames.brevoParameter, signupNames.turnstileParameter].map(name => `arn:aws:ssm:${project.region}:${project.account}:parameter${name}`))
  assert.deepEqual([statement.Action].flat(), ['ssm:PutParameter'])
})
