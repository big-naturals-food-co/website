import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { assertSignupCoverage, rolePolicyDocuments, stackBlocker } from '../lib/signup-preflight.js'

test('preflight distinguishes failed creation, recoverable rollback, and an active operation', () => {
  assert.match(stackBlocker('ROLLBACK_COMPLETE')!, /failed initial creation/)
  assert.match(stackBlocker('UPDATE_IN_PROGRESS')!, /finish this operation/)
  assert.match(stackBlocker('UPDATE_ROLLBACK_FAILED')!, /resolve/)
  assert.equal(stackBlocker('UPDATE_ROLLBACK_COMPLETE'), undefined)
  assert.equal(stackBlocker(undefined), undefined)
})

test('coverage and policy extraction fail closed on unreviewed resources or external policies', () => {
  assert.throws(() => assertSignupCoverage({ Resources: { New: { Type: 'AWS::SQS::Queue' } } }), /AWS::SQS::Queue/)
  assert.throws(() => rolePolicyDocuments({ Resources: {
    Role: { Type: 'AWS::IAM::Role', Properties: { RoleName: 'test', ManagedPolicyArns: ['arn:aws:iam::aws:policy/AdministratorAccess'] } },
  } }, 'test'), /Unresolved managed policy/)
})

test('CLI reports denied stage tagging and retained-resource rollback blockers without mutations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'signup-preflight-'))
  try {
    // Exercise the actual CLI orchestration with a deliberately denied stage
    // action and the production failure's stack state. Unexpected AWS calls fail.
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env node
const args = process.argv.slice(2);
const command = args.slice(0, 2).join(' ');
const value = flag => args[args.indexOf(flag) + 1];
let result;
if (command === 'sts get-caller-identity') result = { Account: '066540957026' };
else if (command === 'iam simulate-principal-policy') {
  const start = args.indexOf('--action-names') + 1;
  const end = args.indexOf('--resource-arns');
  const resource = value('--resource-arns');
  result = { EvaluationResults: args.slice(start, end).map(action => ({
    EvalActionName: action,
    EvalDecision: action === 'apigateway:TagResource' && resource.endsWith('/stages') ? 'implicitDeny' : 'allowed'
  })) };
} else if (command === 'cloudformation describe-stacks') result = { Stacks: [{ StackStatus: 'ROLLBACK_COMPLETE', EnableTerminationProtection: true }] };
else if (command === 'cloudformation list-stack-resources') result = { StackResourceSummaries: [{ ResourceType: 'AWS::Logs::LogGroup', PhysicalResourceId: '/aws/lambda/big-naturals-food-co-signup', ResourceStatus: 'DELETE_SKIPPED' }] };
else if (command === 'logs describe-log-groups') result = { logGroups: [{ logGroupName: '/aws/lambda/big-naturals-food-co-signup' }] };
else if (command === 'iam get-role') result = { Role: {} };
else { console.error('Unexpected AWS operation: ' + command); process.exit(9); }
console.log(JSON.stringify(result));
`, { mode: 0o700 })
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-signup-access.ts', '--profile', 'test'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /apigateway:TagResource -> implicitDeny.*\/stages/)
    assert.match(result.stdout, /FAIL signup stack: ROLLBACK_COMPLETE/)
    assert.match(result.stdout, /FAIL retained log group/)
    assert.match(result.stdout, /PASS API Gateway service-linked role/)
    assert.equal(result.stderr, '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
