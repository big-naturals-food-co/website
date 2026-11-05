import type { ProjectConfig } from './config.js'
import { accessNames, executionRoleArn } from './access.js'
import { signupNames } from './signup-config.js'

export interface Probe {
  name: string
  actions: string[]
  resource: string
  context?: Record<string, string>
}

// Concrete operations required by the configured resource handlers, including
// create/update/delete/read and tags. Optional VPC, EFS, private CA, S3 code,
// customer KMS keys and mutual TLS are not configured in this stack.
export const coveredSignupTypes = new Set([
  'AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Stage',
  'AWS::ApiGatewayV2::DomainName', 'AWS::ApiGatewayV2::ApiMapping',
  'AWS::ApiGatewayV2::Route', 'AWS::ApiGatewayV2::Integration',
  'AWS::Lambda::Function', 'AWS::Lambda::Permission', 'AWS::Logs::LogGroup',
  'AWS::CertificateManager::Certificate', 'AWS::Route53::RecordSet', 'AWS::CDK::Metadata',
])

export function executionProbes(p: ProjectConfig): Probe[] {
  const api = `arn:aws:apigateway:${p.region}::`
  const logs = `arn:aws:logs:${p.region}:${p.account}:log-group:${signupNames.logs}`
  // IAM requires HTTP-method and named API Gateway actions in separate requests.
  const endpoints: [string, string[]][] = [
    ['/apis', ['GET', 'POST']], ['/apis/preflight', ['GET', 'PUT', 'PATCH', 'DELETE']],
    ['/apis/preflight/stages', ['GET', 'POST']], ['/apis/preflight/stages/$default', ['GET', 'PATCH', 'DELETE']],
    ['/apis/preflight/routes', ['GET', 'POST']], ['/apis/preflight/routes/preflight', ['GET', 'PATCH', 'DELETE']],
    ['/apis/preflight/integrations', ['GET', 'POST']], ['/apis/preflight/integrations/preflight', ['GET', 'PATCH', 'DELETE']],
    ['/domainnames', ['GET', 'POST']], [`/domainnames/api.${p.domainName}`, ['GET', 'PATCH', 'DELETE']],
    [`/domainnames/api.${p.domainName}/apimappings`, ['GET', 'POST']], [`/domainnames/api.${p.domainName}/apimappings/preflight`, ['GET', 'PATCH', 'DELETE']],
    [`/tags/${encodeURIComponent(`${api}/apis/preflight`)}`, ['GET', 'POST', 'DELETE']],
  ]
  return [
    ...endpoints.map(([path, methods]) => ({ name: `API ${path}`, actions: methods.map(a => `apigateway:${a}`), resource: `${api}${path}` })),
    ...['/apis/preflight/stages', '/apis/preflight/stages/$default'].map(path => ({
      name: `stage tags ${path}`, actions: ['apigateway:TagResource', 'apigateway:UntagResource'], resource: `${api}${path}`,
    })),
    { name: 'domain certificate association', actions: ['apigateway:AddCertificateToDomain', 'apigateway:RemoveCertificateFromDomain'], resource: `${api}/domainnames/api.${p.domainName}` },
    { name: 'function lifecycle and invocation permission', actions: [
      'CreateFunction', 'GetFunction', 'UpdateFunctionCode', 'UpdateFunctionConfiguration', 'DeleteFunction',
      'TagResource', 'UntagResource', 'ListTags', 'AddPermission', 'RemovePermission', 'GetPolicy',
      'GetFunctionCodeSigningConfig', 'GetRuntimeManagementConfig', 'PutRuntimeManagementConfig',
      'GetFunctionRecursionConfig', 'PutFunctionRecursionConfig',
    ].map(a => `lambda:${a}`), resource: `arn:aws:lambda:${p.region}:${p.account}:function:${signupNames.function}` },
    { name: 'log group lifecycle and read handlers', actions: [
      'CreateLogGroup', 'DeleteLogGroup', 'PutRetentionPolicy', 'DeleteRetentionPolicy',
      'GetDataProtectionPolicy', 'PutDataProtectionPolicy', 'DeleteDataProtectionPolicy',
    ].map(a => `logs:${a}`), resource: `${logs}:*` },
    { name: 'log group tagging', actions: ['logs:TagResource', 'logs:UntagResource', 'logs:ListTagsForResource'], resource: logs },
    { name: 'log configuration discovery', actions: ['logs:DescribeLogGroups', 'logs:DescribeResourcePolicies', 'logs:DescribeIndexPolicies'], resource: '*' },
    { name: 'certificate lifecycle', actions: ['DescribeCertificate', 'ListTagsForCertificate', 'AddTagsToCertificate', 'RemoveTagsFromCertificate', 'UpdateCertificateOptions', 'DeleteCertificate'].map(a => `acm:${a}`), resource: `arn:aws:acm:${p.region}:${p.account}:certificate/00000000-0000-0000-0000-000000000000` },
    { name: 'certificate creation', actions: ['acm:RequestCertificate', 'acm:ListCertificates'], resource: '*' },
    { name: 'DNS records', actions: ['route53:GetHostedZone', 'route53:ListResourceRecordSets', 'route53:ChangeResourceRecordSets'], resource: `arn:aws:route53:::hostedzone/${p.hostedZoneId}` },
    { name: 'DNS discovery', actions: ['route53:ListHostedZones', 'route53:ListHostedZonesByName'], resource: '*' },
    { name: 'DNS stabilization', actions: ['route53:GetChange'], resource: 'arn:aws:route53:::change/preflight' },
    { name: 'pass runtime role', actions: ['iam:PassRole'], resource: `arn:aws:iam::${p.account}:role/${signupNames.role}`, context: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
  ]
}

export function githubProbes(p: ProjectConfig): Probe[] {
  return [
    ...[p.stackName, signupNames.stack].map(name => ({ name: `${name} deployment`, actions: [
      'CreateChangeSet', 'DescribeChangeSet', 'ExecuteChangeSet', 'DeleteChangeSet',
      'DescribeStacks', 'DescribeStackEvents', 'ListStackResources', 'GetTemplate',
      'CreateStack', 'UpdateStack', 'DeleteStack', 'UpdateTerminationProtection',
    ].map(a => `cloudformation:${a}`), resource: `arn:aws:cloudformation:${p.region}:${p.account}:stack/${name}/00000000-0000-0000-0000-000000000000` })),
    { name: 'pass CloudFormation role', actions: ['iam:PassRole'], resource: executionRoleArn(p), context: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } },
    ...[signupNames.brevoParameter, signupNames.turnstileParameter].map(name => ({ name: `store ${name}`, actions: ['ssm:PutParameter'], resource: `arn:aws:ssm:${p.region}:${p.account}:parameter${name}` })),
  ]
}

export function runtimeProbes(p: ProjectConfig): Probe[] {
  return [
    ...[signupNames.brevoParameter, signupNames.turnstileParameter].map(name => ({ name: `read ${name}`, actions: ['ssm:GetParameter'], resource: `arn:aws:ssm:${p.region}:${p.account}:parameter${name}` })),
    // IAM's simulator rejects the plain stream ARN even for Action/Resource '*'.
    // Use its accepted wildcard-suffixed form; actual log delivery still needs
    // integration verification. This does not change the runtime policy.
    { name: 'write runtime logs (simulator ARN)', actions: ['logs:CreateLogStream', 'logs:PutLogEvents'], resource: `arn:aws:logs:${p.region}:${p.account}:log-group:${signupNames.logs}:log-stream:preflight:*` },
  ]
}

type Resource = { Type: string; Properties?: Record<string, any> }
export type CfnTemplate = { Resources: Record<string, Resource> }

/** Extract the policies actually attached in the generated access template. */
export function rolePolicyDocuments(template: CfnTemplate, roleName: string): object[] {
  const entries = Object.entries(template.Resources)
  const role = entries.find(([, r]) => r.Type === 'AWS::IAM::Role' && r.Properties?.RoleName === roleName)
  if (!role) throw new Error(`No synthesized role ${roleName}`)
  const [id, resource] = role
  const documents: object[] = (resource.Properties?.Policies ?? []).map((p: any) => p.PolicyDocument)
  for (const arn of resource.Properties?.ManagedPolicyArns ?? []) {
    const managed = template.Resources[arn.Ref]
    if (managed?.Type !== 'AWS::IAM::ManagedPolicy') throw new Error(`Unresolved managed policy on ${roleName}`)
    documents.push(managed.Properties!.PolicyDocument)
  }
  for (const [, policy] of entries) {
    if (['AWS::IAM::Policy', 'AWS::IAM::ManagedPolicy'].includes(policy.Type)
      && policy.Properties?.Roles?.some((r: any) => r.Ref === id || r === roleName)) {
      documents.push(policy.Properties.PolicyDocument)
    }
  }
  if (!documents.length || /"(?:Ref|Fn::[^"]+)"\s*:/.test(JSON.stringify(documents))) {
    throw new Error(`Missing or unresolved policy documents for ${roleName}`)
  }
  return documents
}

export function assertSignupCoverage(template: CfnTemplate) {
  const missing = [...new Set(Object.values(template.Resources).map(r => r.Type))].filter(t => !coveredSignupTypes.has(t))
  if (missing.length) throw new Error(`Add permission probes for new signup resource types: ${missing.join(', ')}`)
}

export function stackBlocker(status: string | undefined): string | undefined {
  if (!status || ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'IMPORT_COMPLETE', 'IMPORT_ROLLBACK_COMPLETE'].includes(status)) return undefined
  if (status === 'ROLLBACK_COMPLETE') return 'failed initial creation; remove the failed stack record and resolve retained resources before recreating'
  return `stack is ${status}; resolve or finish this operation before deployment`
}

export const checkedRoles = [accessNames.executionRole, accessNames.githubRole, signupNames.role]
