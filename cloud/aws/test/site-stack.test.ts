import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { parseProjectConfig } from '../lib/config.js'
import { landingRequestCode } from '../lib/landing-request.js'
import { SiteStack } from '../lib/site-stack.js'

const example = JSON.parse(readFileSync(new URL('../project.example.json', import.meta.url), 'utf8'))
const project = parseProjectConfig(example)

test('private, retained, versioned bucket is accessible only through this CloudFront distribution', () => {
  const template = Template.fromStack(new SiteStack(new App(), project.stackName, { project }))
  template.resourceCountIs('AWS::S3::Bucket', 1)
  template.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
    Properties: Match.objectLike({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      VersioningConfiguration: { Status: 'Enabled' },
      WebsiteConfiguration: Match.absent(),
      LifecycleConfiguration: Match.absent(),
    }),
  })
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' }),
  })
  const bucketPolicy = Object.values(template.findResources('AWS::S3::BucketPolicy'))[0]!.Properties.PolicyDocument.Statement
  assert.ok(bucketPolicy.some((statement: any) => statement.Effect === 'Deny' && statement.Condition?.Bool?.['aws:SecureTransport'] === 'false'))
  const grants = bucketPolicy.filter((statement: any) => statement.Effect === 'Allow')
  assert.equal(grants.length, 1)
  assert.deepEqual(grants[0].Principal, { Service: 'cloudfront.amazonaws.com' })
  assert.deepEqual([grants[0].Action].flat(), ['s3:GetObject'])
  assert.ok(grants[0].Condition.StringEquals['AWS:SourceArn'])
  for (const type of ['AWS::Lambda::Function', 'AWS::ApiGatewayV2::Api', 'AWS::IAM::User', 'AWS::IAM::AccessKey', 'AWS::Route53::HostedZone']) {
    template.resourceCountIs(type, 0)
  }
})

test('HTTPS, DNS validation, apex/www aliases and edge routing are wired without a 404 fallback', () => {
  const app = new App()
  const stack = new SiteStack(app, project.stackName, { project })
  const template = Template.fromStack(stack)
  assert.equal(stack.terminationProtection, true)
  template.resourceCountIs('AWS::CertificateManager::Certificate', 1)
  template.hasResourceProperties('AWS::CertificateManager::Certificate', {
    DomainName: 'example.com',
    SubjectAlternativeNames: ['www.example.com'],
    ValidationMethod: 'DNS',
    DomainValidationOptions: [
      { DomainName: 'example.com', HostedZoneId: project.hostedZoneId },
      { DomainName: 'www.example.com', HostedZoneId: project.hostedZoneId },
    ],
  })
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Aliases: ['example.com', 'www.example.com'],
      DefaultRootObject: 'index.html',
      CustomErrorResponses: Match.absent(),
      IPV6Enabled: true,
      DefaultCacheBehavior: Match.objectLike({
        AllowedMethods: ['GET', 'HEAD'],
        ViewerProtocolPolicy: 'redirect-to-https',
        FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: Match.anyValue() }],
      }),
      ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021', SslSupportMethod: 'sni-only' }),
      Origins: [Match.objectLike({ OriginAccessControlId: Match.anyValue(), S3OriginConfig: { OriginAccessIdentity: '' } })],
    }),
  })
  template.resourceCountIs('AWS::Route53::RecordSet', 4)
  for (const name of ['example.com.', 'www.example.com.']) {
    for (const type of ['A', 'AAAA']) {
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        HostedZoneId: project.hostedZoneId, Name: name, Type: type,
        AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
      })
    }
  }
  template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
    CachePolicyConfig: Match.objectLike({ MinTTL: 0, DefaultTTL: 300, MaxTTL: 31536000 }),
  })
  // A newly introduced asset deployment could silently add a Lambda or public upload path.
  template.resourceCountIs('Custom::CDKBucketDeployment', 0)
})

const handler = runInNewContext(`${landingRequestCode('example.com')}; handler`)
function request(uri: string, host = 'example.com', querystring = {}) {
  return { uri, method: 'GET', headers: { host: { value: host } }, querystring }
}

test('root and Nuxt assets pass through unchanged', () => {
  for (const uri of ['/', '/favicon.svg', '/_payload.json', '/_nuxt/entry.abc.css', '/_nuxt/builds/latest.json']) {
    const original = request(uri)
    assert.equal(handler({ request: original }), original)
  }
})

test('all other page URLs redirect to root, including file-like and encoded paths', () => {
  for (const uri of ['/about', '/about/', '/a/b', '/404.html', '/index.html', '/anything.pdf', '/%61bout', '//outside.example/path']) {
    const response = handler({ request: request(uri) })
    assert.equal(response.statusCode, 302)
    assert.equal(response.headers.location.value, 'https://example.com/')
  }
})

test('redirects canonicalize www and preserve repeated/encoded query values', () => {
  const query = { utm_source: { value: 'email%20launch' }, tag: { multiValue: [{ value: 'a' }, { value: 'b%26c' }] } }
  assert.equal(handler({ request: request('/news', 'www.example.com', query) }).headers.location.value,
    'https://example.com/?utm_source=email%20launch&tag=a&tag=b%26c')
  assert.equal(handler({ request: request('/', 'www.example.com') }).headers.location.value, 'https://example.com/')
  assert.equal(handler({ request: request('/_nuxt/app.js', 'www.example.com') }).headers.location.value, 'https://example.com/_nuxt/app.js')
  assert.equal(handler({ request: request('/', 'untrusted.example') }).headers.location.value, 'https://example.com/')
})

test('configuration fails early for incorrect accounts, regions and DNS boundaries', () => {
  for (const invalid of [
    { account: 'not-an-account' }, { region: 'us-west-2' }, { hostedZoneId: '' },
    { domainName: 'https://example.com' }, { redirectDomainNames: ['outside.example.net'] },
    { redirectDomainNames: ['example.com'] }, { zoneName: 'other.example.com' },
  ]) {
    assert.throws(() => parseProjectConfig({ ...example, ...invalid }))
  }
})
