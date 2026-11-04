export interface SignupConfig {
  enabled: boolean
  brevoListId: number | null
  turnstileSiteKey: string
}

export const signupNames = {
  stack: 'BigNaturalsFoodCoSignup',
  function: 'big-naturals-food-co-signup',
  role: 'big-naturals-food-co-signup-runtime',
  logs: '/aws/lambda/big-naturals-food-co-signup',
  brevoParameter: '/big-naturals-food-co/signup/brevo-api-key',
  turnstileParameter: '/big-naturals-food-co/signup/turnstile-secret',
}

export function parseSignupConfig(input: unknown): SignupConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid signup configuration.')
  const config = input as Record<string, unknown>
  if (typeof config.enabled !== 'boolean' || typeof config.turnstileSiteKey !== 'string'
    || (config.brevoListId !== null && (!Number.isSafeInteger(config.brevoListId) || Number(config.brevoListId) < 1))) {
    throw new Error('Signup requires enabled, a public Turnstile site key, and a positive Brevo list ID (or null before setup).')
  }
  if (config.turnstileSiteKey !== '' && !/^0x[A-Za-z0-9_-]{20,100}$/.test(config.turnstileSiteKey)) {
    throw new Error('Use a real Turnstile public site key; test keys are for browser tests only.')
  }
  if (config.enabled && (!config.turnstileSiteKey || config.brevoListId === null)) {
    throw new Error('Configure the new business Turnstile widget and Brevo list before enabling signup.')
  }
  return config as unknown as SignupConfig
}
