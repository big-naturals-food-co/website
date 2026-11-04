import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, type TestContext } from 'node:test'
import { parseProjectConfig } from '../lib/config.js'
import { assertPublicationIdentity, deploymentDestination, publicationPlan, publishFiles, verifySite } from '../lib/publication.js'

const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.example.json', import.meta.url), 'utf8')))
const outputs = { [project.stackName]: {
  BucketName: `big-naturals-food-co-site-${project.account}-${project.region}`,
  SiteUrl: 'https://example.com', DistributionId: 'EXAMPLE123',
} }

function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'big-naturals-publication-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(path.join(directory, '_nuxt/builds/meta'), { recursive: true })
  const files = {
    'index.html': '<html><head><link href="/_nuxt/entry.hash.css" rel="stylesheet"></head><body>Big Naturals<script src="/_nuxt/chunk.hash.js"></script></body></html>',
    'favicon.svg': '<svg></svg>', '_payload.json': '{}',
    '_nuxt/entry.hash.css': 'body{color:red}', '_nuxt/chunk.hash.js': 'console.log("ok")',
    '_nuxt/builds/latest.json': '{"id":"new-build"}', '_nuxt/builds/meta/new-build.json': '{}',
  }
  for (const [key, value] of Object.entries(files)) writeFileSync(path.join(directory, key), value)
  return { directory, files }
}

test('publication uploads assets before HTML and publishes the mutable build marker last', (t) => {
  const { directory } = fixture(t)
  const plan = publicationPlan(directory)
  const index = plan.findIndex(file => file.key === 'index.html')
  assert.ok(plan.findIndex(file => file.key === '_nuxt/chunk.hash.js') < index)
  assert.ok(plan.findIndex(file => file.key === '_payload.json') < index)
  assert.equal(plan.at(-1)!.key, '_nuxt/builds/latest.json')
  assert.ok(plan.find(file => file.key === '_nuxt/chunk.hash.js')!.cacheControl.includes('immutable'))
  for (const file of plan.filter(file => file.key.includes('/builds/') || file.key === 'index.html')) {
    assert.ok(!file.cacheControl.includes('immutable'))
    assert.ok(file.cacheControl.includes('max-age=300'))
  }
})

test('publication rejects empty output, stray files, and symlinks before upload', (t) => {
  const { directory } = fixture(t)
  writeFileSync(path.join(directory, '.env'), 'secret')
  assert.throws(() => publicationPlan(directory), /hidden file/)
  rmSync(path.join(directory, '.env'))
  symlinkSync(path.join(directory, 'index.html'), path.join(directory, '_nuxt/linked.js'))
  assert.throws(() => publicationPlan(directory), /symlink/)
  rmSync(path.join(directory, '_nuxt/linked.js'))
  writeFileSync(path.join(directory, '404.html'), 'no')
  assert.throws(() => publicationPlan(directory), /not recognized/)
  rmSync(path.join(directory, '404.html'))
  writeFileSync(path.join(directory, 'index.html'), '')
  assert.throws(() => publicationPlan(directory), /non-empty index/)
  rmSync(path.join(directory, 'index.html'))
  assert.throws(() => publicationPlan(directory), /non-empty index/)
})

test('publication refuses mismatched destinations, wrong accounts and root credentials', () => {
  assert.equal(deploymentDestination(outputs, project).distributionId, 'EXAMPLE123')
  for (const change of [{ BucketName: 'another-project' }, { SiteUrl: 'https://elsewhere.example' }, { DistributionId: '../other' }]) {
    assert.throws(() => deploymentDestination({ [project.stackName]: { ...outputs[project.stackName], ...change } }, project))
  }
  assert.throws(() => assertPublicationIdentity({ Account: '222222222222', Arn: 'arn:aws:iam::222222222222:user/operator' }, project))
  assert.throws(() => assertPublicationIdentity({ Account: project.account, Arn: `arn:aws:iam::${project.account}:root` }, project))
  assertPublicationIdentity({ Account: project.account, Arn: `arn:aws:sts::${project.account}:assumed-role/deploy/run` }, project)
})

test('publication never deletes old files and waits for invalidation after all uploads', (t) => {
  const { directory } = fixture(t)
  const plan = publicationPlan(directory)
  const calls: string[][] = []
  const id = publishFiles(plan, deploymentDestination(outputs, project), args => {
    calls.push(args)
    return args[1] === 'create-invalidation' ? '{"Invalidation":{"Id":"INVALIDATION123"}}' : ''
  })
  assert.equal(id, 'INVALIDATION123')
  assert.equal(calls.length, plan.length + 2)
  assert.ok(calls.slice(0, plan.length).every(args => args[0] === 's3' && args[1] === 'cp'))
  assert.ok(calls.every(args => !args.includes('--delete') && !args.includes('rm')))
  assert.equal(calls.at(-2)![1], 'create-invalidation')
  assert.equal(calls.at(-1)![1], 'wait')
})

test('an asset upload failure stops before HTML publication or invalidation', (t) => {
  const { directory } = fixture(t)
  const calls: string[][] = []
  assert.throws(() => publishFiles(publicationPlan(directory), deploymentDestination(outputs, project), args => {
    calls.push(args)
    throw new Error('upload failed')
  }), /upload failed/)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]![3]!.includes('/_nuxt/'))
})

test('public verification detects stale HTML, broken assets, and incorrect redirects', async (t) => {
  const { directory, files } = fixture(t)
  let failure: 'html' | 'asset' | 'redirect' | undefined
  const request: typeof fetch = async input => {
    const url = new URL(String(input))
    if (url.hostname === 'www.example.com' || url.pathname === '/__deployment-check') {
      return new Response(null, { status: 302, headers: { location: failure === 'redirect' ? 'https://outside.example/' : 'https://example.com/' } })
    }
    const key = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const body = files[key as keyof typeof files]
    if (failure === 'html' && key === 'index.html') return new Response('old build')
    if (failure === 'asset' && key.endsWith('.js')) return new Response('missing', { status: 404 })
    return new Response(body, { status: body ? 200 : 404 })
  }
  await verifySite(directory, project, request)
  failure = 'html'
  await assert.rejects(verifySite(directory, project, request), /homepage/)
  failure = 'asset'
  await assert.rejects(verifySite(directory, project, request), /asset/)
  failure = 'redirect'
  await assert.rejects(verifySite(directory, project, request), /redirect/)
})
