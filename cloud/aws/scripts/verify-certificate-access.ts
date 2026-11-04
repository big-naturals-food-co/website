import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { accessNames, executionRoleArn } from '../lib/access.js'
import { parseProjectConfig } from '../lib/config.js'

// Read-only AWS IAM simulations of broad service permissions on the deployed role.
// Run with an administrator's AWS_PROFILE; never deploys resources.
const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8')))
const certificate = `arn:aws:acm:${project.region}:${project.account}:certificate/00000000-0000-0000-0000-000000000000`
type Context = Record<string, string | string[]>
const owned: Context = { 'aws:ResourceTag/Project': accessNames.projectTag }
const other: Context = { 'aws:ResourceTag/Project': 'OtherProject' }
const creating: Context = { 'aws:RequestTag/Project': accessNames.projectTag }
const request: Context = {
  'acm:DomainNames': [project.domainName, ...project.redirectDomainNames],
  'acm:ValidationMethod': 'DNS', 'aws:RequestedRegion': project.region,
}
let failures = 0
let checks = 0
function check(name: string, action: string, allowed: boolean, context: Context = {}, resource = certificate) {
  const entries = Object.entries(context).map(([key, value]) => ({
    ContextKeyName: key, ContextKeyValues: Array.isArray(value) ? value : [value],
    ContextKeyType: Array.isArray(value) ? 'stringList' : 'string',
  }))
  const result = JSON.parse(execFileSync('aws', [
    'iam', 'simulate-principal-policy', '--policy-source-arn', executionRoleArn(project),
    '--action-names', `acm:${action}`, '--resource-arns', resource,
    ...(entries.length ? ['--context-entries', JSON.stringify(entries)] : []),
    '--output', 'json', '--no-cli-pager',
  ], { encoding: 'utf8', timeout: 30_000 }))
  const evaluation = result.EvaluationResults[0]
  const passed = (evaluation.EvalDecision === 'allowed') === allowed
  checks++
  if (!passed) failures++
  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name} (${evaluation.EvalDecision})`)
}

check('request before tagging', 'RequestCertificate', true, request, '*')
check('allow certificate requests for any domain', 'RequestCertificate', true, { ...request, 'acm:DomainNames': [project.domainName, 'outside.example.org'] }, '*')
check('allow email validation', 'RequestCertificate', true, { ...request, 'acm:ValidationMethod': 'EMAIL' }, '*')
check('reject other regions', 'RequestCertificate', false, { ...request, 'aws:RequestedRegion': 'us-west-2' }, '*')
for (const action of ['DescribeCertificate', 'ListTagsForCertificate']) {
  check(`${action} before tags are visible`, action, true)
  check(`${action} after tagging`, action, true, owned)
  check(`${action} permits any project tag in this account`, action, true, other)
  check(`${action} rejects another region`, action, false, {}, certificate.replace(':us-east-1:', ':us-west-2:'))
  check(`${action} rejects another account`, action, false, {}, certificate.replace(`:${project.account}:`, ':000000000000:'))
}
check('apply initial project tags', 'AddTagsToCertificate', true, creating)
check('manage tags across certificates in this account', 'AddTagsToCertificate', true, { ...creating, ...other })
for (const action of ['UpdateCertificateOptions', 'DeleteCertificate']) {
  check(`${action} permits untagged certificates`, action, true)
  check(`${action} permits project certificate`, action, true, owned)
  check(`${action} permits any project tag in this account`, action, true, other)
}
check('can remove project tags', 'RemoveTagsFromCertificate', true, { ...owned, 'aws:TagKeys': ['Project'] })
console.log(`${checks - failures}/${checks} live-role IAM simulations passed; no resources changed.`)
if (failures) process.exitCode = 1
