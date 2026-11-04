const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createHandler, createSecretLoader } = require('../lambda/signup.cjs')

const input = { email: ' Person+news@example.com ', consent: true, name: '', source: 'landing-page', turnstileToken: 'test-token' }
const event = (body = input) => ({ body: JSON.stringify(body), headers: { origin: 'https://example.com', 'content-type': 'application/json' }, requestContext: { http: { method: 'POST' } } })
const verified = { success: true, hostname: 'example.com', action: 'subscribe' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
function harness(responses = [json(verified), json({}, 404), json({}, 201)], overrides = {}) {
  const calls = [], logs = []
  let secretCalls = 0
  const handler = createHandler({ enabled: true, origin: 'https://example.com', listId: 7, ...overrides }, {
    secrets: async () => { secretCalls++; return { turnstile: 'private-turnstile', brevo: 'private-brevo' } },
    fetch: async (...args) => { calls.push(args); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) throw new Error('unexpected request'); return next },
    log: value => logs.push(value),
  })
  return { handler, calls, logs, secretCalls: () => secretCalls }
}

test('valid signup verifies Turnstile before saving to only the selected Brevo list', async () => {
  const h = harness()
  assert.equal((await h.handler(event())).statusCode, 200)
  assert.deepEqual(JSON.parse(h.calls[0][1].body), { secret: 'private-turnstile', response: 'test-token' })
  assert.match(h.calls[1][0], /Person%2Bnews%40example.com/)
  assert.deepEqual(JSON.parse(h.calls[2][1].body), { email: 'Person+news@example.com', listIds: [7], updateEnabled: false })
  assert.ok(h.calls.every(([, options]) => options.redirect === 'error' && options.signal instanceof AbortSignal))
  assert.deepEqual(h.logs, [{ outcome: 'accepted' }])
})

test('disabled, incorrect method/origin/content type and malformed payloads never reach providers', async () => {
  const h = harness()
  const cases = [
    [{ ...event(), requestContext: { http: { method: 'GET' } } }, 405],
    [{ ...event(), headers: { ...event().headers, origin: 'https://other.example' } }, 403],
    [{ ...event(), headers: { ...event().headers, 'content-type': 'text/plain' } }, 415],
    [{ ...event(), body: '{' }, 400], [{ ...event(), body: 'x'.repeat(9000) }, 400],
    ...[null, [], { ...input, consent: false }, { ...input, name: 'bot' }, { ...input, source: 'other-business' },
      { ...input, turnstileToken: '' }, { ...input, turnstileToken: 'x'.repeat(2049) },
      ...['bad', '.bad@example.com', 'a..b@example.com', 'a@example..com', 'a@-example.com', 'a@example.com\nCc: victim@example.com'].map(email => ({ ...input, email })),
    ].map(body => [event(body), 400]),
  ]
  for (const [request, status] of cases) assert.equal((await h.handler(request)).statusCode, status)
  assert.equal(h.secretCalls(), 0)
  assert.equal(h.calls.length, 0)
  for (const overrides of [{ enabled: false }, { listId: 0 }]) {
    const disabled = harness([], overrides)
    assert.equal((await disabled.handler(event())).statusCode, 503)
    assert.equal(disabled.secretCalls(), 0)
  }
})

test('base64 bodies and case-insensitive headers work', async () => {
  const h = harness()
  assert.equal((await h.handler({ ...event(), body: Buffer.from(JSON.stringify(input)).toString('base64'), isBase64Encoded: true,
    headers: { Origin: 'https://example.com', 'Content-Type': 'application/json; charset=utf-8' } })).statusCode, 200)
})

test('invalid, expired, wrong-host and wrong-action tokens cannot reach Brevo', async () => {
  for (const value of [{ ...verified, success: false }, { ...verified, hostname: 'other.example' }, { ...verified, action: 'login' }, null]) {
    const h = harness([json(value)])
    assert.equal((await h.handler(event())).statusCode, 403)
    assert.equal(h.calls.length, 1)
  }
})

test('existing list membership and unsubscribes are idempotent and never cleared', async () => {
  for (const contact of [
    { emailBlacklisted: false, listIds: [7] },
    { emailBlacklisted: true, listIds: [] },
    { emailBlacklisted: false, listIds: [], listUnsubscribed: [7] },
  ]) {
    const h = harness([json(verified), json(contact)])
    assert.deepEqual(JSON.parse((await h.handler(event())).body), { accepted: true })
    assert.equal(h.calls.length, 2)
  }
})

test('existing eligible contacts join the list without rewriting their attributes', async () => {
  const h = harness([json(verified), json({ emailBlacklisted: false, listIds: [3] }), new Response(null, { status: 204 })])
  assert.equal((await h.handler(event())).statusCode, 200)
  assert.deepEqual(JSON.parse(h.calls[2][1].body), { email: 'Person+news@example.com', listIds: [7], updateEnabled: true })
})

test('upstream failures, rate limits, races, malformed responses and unsupported consent groups never claim success', async () => {
  for (const responses of [
    [json({}, 500)], [new Error('private error with email@example.com')],
    [json(verified), json({}, 401)], [json(verified), json({}, 429)],
    [json(verified), json({})], [json(verified), json({ emailBlacklisted: false, listIds: [], consentGroups: [] })],
    [json(verified), json({}, 404), json({ code: 'duplicate_parameter' }, 400)],
    [json(verified), json({}, 404), json({}, 503)],
    [json(verified), json({}, 404), new Error('timeout after possible write')],
  ]) {
    const h = harness(responses)
    const result = await h.handler(event())
    assert.equal(result.statusCode, 503)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.ok(!JSON.stringify({ result, logs: h.logs }).includes('@'))
    assert.ok(!JSON.stringify({ result, logs: h.logs }).includes('private'))
    assert.equal(responses.length, 0)
  }
})

test('missing secrets fail closed and loader caches only a complete successful pair', async () => {
  const calls = []
  let missing = true
  class Command { constructor(input) { this.input = input } }
  const load = createSecretLoader({ send: async (command, options) => {
    calls.push({ command, options })
    return { Parameter: { Value: missing && command.input.Name === '/brevo' ? '' : 'secret-value' } }
  } }, Command, { brevo: '/brevo', turnstile: '/turnstile' })
  await assert.rejects(load(AbortSignal.timeout(1000)), /missing_secret/)
  missing = false
  assert.deepEqual(await load(AbortSignal.timeout(1000)), { brevo: 'secret-value', turnstile: 'secret-value' })
  await load(AbortSignal.timeout(1000))
  assert.equal(calls.length, 4)
  assert.ok(calls.every(({ command }) => command.input.WithDecryption === true))
  const handler = createHandler({ enabled: true, origin: 'https://example.com', listId: 7 }, {
    secrets: async () => { throw new Error('private') }, fetch: () => assert.fail('must not call providers'), log: () => {},
  })
  assert.equal((await handler(event())).statusCode, 503)
})
