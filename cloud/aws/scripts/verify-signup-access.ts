import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { AccessStack } from '../lib/access-stack.js'
import { SignupStack } from '../lib/signup-stack.js'
import { accessNames } from '../lib/access.js'
import { parseProjectConfig } from '../lib/config.js'
import { parseSignupConfig, signupNames } from '../lib/signup-config.js'
import { assertSignupCoverage, checkedRoles, executionProbes, githubProbes, rolePolicyDocuments, runtimeProbes, stackBlocker, type CfnTemplate } from '../lib/signup-preflight.js'

// All AWS calls in this script are read-only. No secret values are fetched.
const { values } = parseArgs({ options: {
  profile: { type: 'string' }, policy: { type: 'string', default: 'live' },
  'permissions-only': { type: 'boolean', default: false },
} })
if (!['live', 'proposed'].includes(values.policy!)) throw new Error('--policy must be live or proposed')
const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8')))
const signup = parseSignupConfig(JSON.parse(readFileSync(new URL('../../signup.json', import.meta.url), 'utf8')))
function aws(...args: string[]): any {
  return JSON.parse(execFileSync('aws', [...args,
    ...(values.profile ? ['--profile', values.profile] : []), '--region', project.region,
    '--output', 'json', '--no-cli-pager', '--no-cli-auto-prompt',
  ], { encoding: 'utf8', timeout: 45_000, stdio: ['ignore', 'pipe', 'pipe'] }))
}

async function main() {
  const identity = aws('sts', 'get-caller-identity')
  if (identity.Account !== project.account) throw new Error(`Expected AWS account ${project.account}; got ${identity.Account}`)
  const app = new App()
  const access = Template.fromStack(new AccessStack(app, accessNames.stack, { project })).toJSON() as CfnTemplate
  const template = Template.fromStack(new SignupStack(new App(), signupNames.stack, { project, signup })).toJSON() as CfnTemplate
  assertSignupCoverage(template)
  console.log(`Checking ${values.policy} policies in ${project.account}/${project.region}; AWS calls are read-only.`)
  let failures = 0
  let checks = 0
  const groups = [executionProbes(project), githubProbes(project), runtimeProbes(project)]
  for (const [index, role] of checkedRoles.entries()) {
    const documents = rolePolicyDocuments(access, role).map(d => JSON.stringify(d))
    for (const probe of groups[index]!) {
      const context = { 'aws:RequestedRegion': project.region, ...probe.context }
      const result = aws('iam', values.policy === 'proposed' ? 'simulate-custom-policy' : 'simulate-principal-policy',
        ...(values.policy === 'proposed' ? ['--policy-input-list', ...documents] : ['--policy-source-arn', `arn:aws:iam::${project.account}:role/${role}`]),
        '--action-names', ...probe.actions, '--resource-arns', probe.resource,
        '--context-entries', JSON.stringify(Object.entries(context).map(([name, value]) => ({ ContextKeyName: name, ContextKeyValues: [value], ContextKeyType: 'string' }))))
      const evaluations = result.EvaluationResults ?? []
      if (result.IsTruncated || evaluations.length !== probe.actions.length) throw new Error(`Incomplete IAM simulation for ${probe.name}`)
      let denied = 0
      for (const evaluation of evaluations) {
        checks++
        if (evaluation.EvalDecision !== 'allowed') {
          failures++; denied++
          console.log(`FAIL ${role}: ${evaluation.EvalActionName} -> ${evaluation.EvalDecision} on ${probe.resource}${evaluation.MissingContextValues?.length ? ` (missing context: ${evaluation.MissingContextValues.join(', ')})` : ''}`)
        }
      }
      if (!denied) console.log(`PASS ${role}: ${probe.name} (${evaluations.length})`)
    }
  }
  console.log(`${checks - failures}/${checks} ${values.policy} permission checks allowed.`)
  if (!values['permissions-only']) {
    let stack: any
    try {
      stack = aws('cloudformation', 'describe-stacks', '--stack-name', signupNames.stack).Stacks[0]
    } catch (error: any) {
      if (!/ValidationError[\s\S]*Stack with id [^\n]+ does not exist/.test(String(error.stderr))) throw error
    }
    const blocker = stackBlocker(stack?.StackStatus)
    console.log(`${blocker ? 'FAIL' : 'PASS'} signup stack: ${stack?.StackStatus ?? 'not created'}${stack?.EnableTerminationProtection ? ' (termination protection enabled)' : ''}${blocker ? `; ${blocker}` : ''}`)
    if (blocker) failures++
    const resources = stack ? aws('cloudformation', 'list-stack-resources', '--stack-name', signupNames.stack).StackResourceSummaries : []
    const groups = aws('logs', 'describe-log-groups', '--log-group-name-prefix', signupNames.logs).logGroups
    const existing = groups.find((g: any) => g.logGroupName === signupNames.logs)
    const managed = resources.some((r: any) => r.ResourceType === 'AWS::Logs::LogGroup' && r.PhysicalResourceId === signupNames.logs && !r.ResourceStatus.startsWith('DELETE'))
    if (existing && !managed) {
      failures++
      console.log(`FAIL retained log group ${signupNames.logs} exists outside active stack management; import/preserve it or explicitly remove it before recreation.`)
    } else console.log('PASS no unmanaged signup log-group name collision')
    aws('iam', 'get-role', '--role-name', 'AWSServiceRoleForAPIGateway')
    console.log('PASS API Gateway service-linked role exists')
  }
  console.log('Simulation checks policy decisions, not an actual deployment or provider signup. SCPs, resource policies, quotas, service behavior and GitHub OIDC execution require separate integration verification.')
  if (values['permissions-only']) console.log('Stack state was not checked (--permissions-only).')
  if (failures) process.exitCode = 1
}

main().catch((error: any) => {
  // Calls above never retrieve secret values; CLI stderr contains diagnostic metadata only.
  console.error(`Preflight could not complete: ${error.stderr?.toString().trim() || error.message}`)
  process.exitCode = 1
})
