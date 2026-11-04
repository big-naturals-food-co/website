import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { parseProjectConfig } from '../lib/config.js'
import { parseSignupConfig, signupNames } from '../lib/signup-config.js'
import { SignupStack } from '../lib/signup-stack.js'
import { signupRuntimeStatements } from '../lib/access.js'

const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.example.json', import.meta.url), 'utf8')))
const signup = parseSignupConfig({ enabled: false, brevoListId: null, turnstileSiteKey: '' })

test('signup uses separate API/certificate, exact origin, throttling, and an imported project runtime role', () => {
  const stack = new SignupStack(new App(), signupNames.stack, { project, signup })
  const template = Template.fromStack(stack)
  assert.equal(stack.terminationProtection, true)
  template.resourceCountIs('AWS::IAM::Role', 0)
  template.resourceCountIs('AWS::IAM::Policy', 0)
  template.resourceCountIs('AWS::SSM::Parameter', 0)
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: signupNames.function, Handler: 'index.handler', Runtime: 'nodejs24.x', Timeout: 15,
    Role: `arn:aws:iam::${project.account}:role/${signupNames.role}`,
    Environment: { Variables: {
      SIGNUP_ENABLED: 'false', ALLOWED_ORIGIN: 'https://example.com', BREVO_LIST_ID: '0',
      BREVO_PARAMETER: signupNames.brevoParameter, TURNSTILE_PARAMETER: signupNames.turnstileParameter,
    } },
    Code: { ZipFile: Match.stringLikeRegexp('createHandler') },
  })
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true, CorsConfiguration: {
    AllowOrigins: ['https://example.com'], AllowHeaders: ['content-type'], AllowMethods: ['POST', 'OPTIONS'], MaxAge: 300,
  } })
  template.hasResourceProperties('AWS::ApiGatewayV2::Stage', { DefaultRouteSettings: { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 } })
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /subscribe' })
  template.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'api.example.com' })
  template.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'api.example.com.', Type: 'A' })
  template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ RetentionInDays: 30 }) })
})

test('runtime reads only the two project secrets and writes only its log group', () => {
  const policy = signupRuntimeStatements(project).map(statement => statement.toStatementJson())
  assert.deepEqual(policy[0]!.Resource, [signupNames.brevoParameter, signupNames.turnstileParameter].map(name => `arn:aws:ssm:us-east-1:${project.account}:parameter${name}`))
  assert.equal(policy[0]!.Action, 'ssm:GetParameter')
  assert.deepEqual(policy[1]!.Action, ['logs:CreateLogStream', 'logs:PutLogEvents'])
})

test('signup cannot be enabled with missing settings, test keys, or invalid list IDs', () => {
  for (const invalid of [{ enabled: true }, { brevoListId: -1 }, { brevoListId: 1.5 }, { brevoListId: '7' },
    { turnstileSiteKey: '1x00000000000000000000AA' }, { enabled: 'false' }]) {
    assert.throws(() => parseSignupConfig({ ...signup, ...invalid }))
  }
  assert.equal(parseSignupConfig({ enabled: true, brevoListId: 7, turnstileSiteKey: `0x${'a'.repeat(22)}` }).enabled, true)
})
