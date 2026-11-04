// Kept as plain CommonJS so CloudFormation can package this small function inline.
// The only SDK dependency is SSM, supplied by the managed Node.js Lambda runtime.
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const listIds = value => Array.isArray(value) && value.every(id => Number.isSafeInteger(id) && id > 0)
const response = statusCode => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(statusCode === 200 ? { accepted: true } : { error: 'Unable to process signup.' }),
})

function parse(event) {
  if (typeof event.body !== 'string' || event.body.length > 8192) return null
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  if (Buffer.byteLength(body) > 4096) return null
  let input
  try { input = JSON.parse(body) } catch { return null }
  if (!isObject(input) || input.consent !== true || input.name !== '' || input.source !== 'landing-page'
    || typeof input.email !== 'string' || typeof input.turnstileToken !== 'string') return null
  const email = input.email.trim()
  const [local, domain, extra] = email.split('@')
  if (email.length > 254 || extra !== undefined || !local || local.length > 64
    || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !domain?.includes('.') || domain.split('.').some(label => label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))
    || input.turnstileToken.length < 1 || input.turnstileToken.length > 2048) return null
  return { email, token: input.turnstileToken }
}

function createHandler(settings, dependencies) {
  return async event => {
    if (!settings.enabled || !Number.isSafeInteger(settings.listId) || settings.listId < 1) return response(503)
    if (event.requestContext?.http?.method !== 'POST') return response(405)
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
    if (headers.origin !== settings.origin) return response(403)
    if (headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return response(415)
    const input = parse(event)
    if (!input) return response(400)
    const signal = AbortSignal.timeout(12000)
    let stage = 'secrets'
    try {
      const secrets = await dependencies.secrets(signal)
      stage = 'verification'
      const verification = await dependencies.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: secrets.turnstile, response: input.token }),
      })
      if (!verification.ok) throw new Error('upstream')
      const verified = await verification.json()
      if (!isObject(verified) || verified.success !== true || verified.hostname !== new URL(settings.origin).hostname || verified.action !== 'subscribe') {
        dependencies.log({ outcome: 'verification_rejected' })
        return response(403)
      }
      stage = 'subscription'
      const brevoHeaders = { 'api-key': secrets.brevo, accept: 'application/json', 'content-type': 'application/json' }
      const contact = await dependencies.fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(input.email)}?identifierType=email_id`, {
        headers: brevoHeaders, redirect: 'error', signal,
      })
      if (contact.ok) {
        const data = await contact.json()
        if (!isObject(data) || typeof data.emailBlacklisted !== 'boolean' || !listIds(data.listIds)
          || (data.listUnsubscribed !== undefined && !listIds(data.listUnsubscribed))) throw new Error('upstream')
        // Preserve existing unsubscribes and avoid exposing membership through the API.
        if (data.emailBlacklisted || data.listUnsubscribed?.includes(settings.listId) || data.listIds.includes(settings.listId)) {
          dependencies.log({ outcome: 'accepted' })
          return response(200)
        }
        if (data.consentGroups !== undefined) throw new Error('consent_groups_require_configuration')
      } else if (contact.status !== 404) throw new Error('upstream')
      signal.throwIfAborted()
      const saved = await dependencies.fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST', headers: brevoHeaders, redirect: 'error', signal,
        // Never clear blocklist flags, overwrite attributes, or change an existing email.
        body: JSON.stringify({ email: input.email, listIds: [settings.listId], updateEnabled: contact.ok }),
      })
      if (!saved.ok) throw new Error('upstream')
      dependencies.log({ outcome: 'accepted' })
      return response(200)
    } catch {
      // Exceptions and upstream bodies can include addresses or secrets. Log labels only.
      dependencies.log({ outcome: `${stage}_failed` })
      return response(503)
    }
  }
}

function createSecretLoader(client, Command, names) {
  let cached
  let expires = 0
  return async signal => {
    if (cached && Date.now() < expires) return cached
    const values = await Promise.all(Object.entries(names).map(async ([key, Name]) => {
      const result = await client.send(new Command({ Name, WithDecryption: true }), { abortSignal: signal })
      const value = result.Parameter?.Value
      if (!value) throw new Error('missing_secret')
      return [key, value]
    }))
    cached = Object.fromEntries(values)
    expires = Date.now() + 60000
    return cached
  }
}

let runtimeHandler
exports.handler = async event => {
  if (!runtimeHandler) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
    runtimeHandler = createHandler({
      enabled: process.env.SIGNUP_ENABLED === 'true',
      origin: process.env.ALLOWED_ORIGIN,
      listId: Number(process.env.BREVO_LIST_ID),
    }, {
      fetch,
      secrets: createSecretLoader(new SSMClient({ maxAttempts: 1 }), GetParameterCommand, {
        turnstile: process.env.TURNSTILE_PARAMETER, brevo: process.env.BREVO_PARAMETER,
      }),
      log: event => console.info(JSON.stringify(event)),
    })
  }
  return runtimeHandler(event)
}
exports.createHandler = createHandler
exports.createSecretLoader = createSecretLoader
