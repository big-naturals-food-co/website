<script setup lang="ts">
import { loadTurnstile, type TurnstileApi } from '~/utils/turnstile'

const config = useRuntimeConfig().public
const enabled = computed(() => String(config.signupEnabled) === 'true' && !!config.signupEndpoint && !!config.turnstileSiteKey)
const email = ref('')
const consent = ref(false)
const name = ref('')
const token = ref('')
const mounted = ref(false)
const busy = ref(false)
const accepted = ref(false)
const message = ref('')
const verificationMessage = ref('')
const verificationFailed = ref(false)
const challenge = ref<HTMLElement>()
const success = ref<HTMLElement>()
let turnstile: TurnstileApi | undefined
let widgetId: string | undefined
let attempt = 0
let controller: AbortController | undefined

function verificationError(text = 'Verification could not finish. Please try again.') {
  token.value = ''
  verificationFailed.value = true
  verificationMessage.value = text
}

async function verify() {
  const current = ++attempt
  token.value = ''
  verificationFailed.value = false
  verificationMessage.value = 'Loading verification…'
  if (widgetId !== undefined) turnstile?.remove(widgetId)
  widgetId = undefined
  try {
    turnstile = await loadTurnstile()
    if (!mounted.value || current !== attempt || !challenge.value) return
    const active = () => mounted.value && current === attempt
    widgetId = turnstile.render(challenge.value, {
      sitekey: config.turnstileSiteKey, action: 'subscribe', theme: 'light',
      size: 'compact', appearance: 'interaction-only', retry: 'never',
      'response-field': false, 'refresh-expired': 'manual', 'refresh-timeout': 'manual',
      callback: value => {
        if (!active()) return
        token.value = value
        verificationFailed.value = false
        verificationMessage.value = ''
      },
      'error-callback': () => { if (active()) verificationError() },
      'expired-callback': () => { if (active()) verificationError('Verification expired. Please verify again.') },
      'timeout-callback': () => { if (active()) verificationError() },
      'before-interactive-callback': () => { if (active()) verificationMessage.value = 'Complete the verification below.' },
      'after-interactive-callback': () => {},
    })
    if (widgetId === undefined) throw new Error('Verification unavailable')
  } catch {
    if (mounted.value && current === attempt) verificationError('Verification could not load. Check your connection and try again.')
  }
}

async function submit() {
  if (!enabled.value || !mounted.value || busy.value || accepted.value || !consent.value || !token.value) return
  if (name.value) { message.value = 'Unable to process signup. Please refresh and try again.'; return }
  busy.value = true
  message.value = ''
  controller = new AbortController()
  const timer = window.setTimeout(() => controller?.abort(), 18000)
  try {
    const result = await fetch(config.signupEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'omit', redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ email: email.value.trim(), consent: consent.value, name: name.value, source: 'landing-page', turnstileToken: token.value }),
    })
    if (!result.ok) {
      if (result.status === 429) message.value = 'Too many requests right now. Please wait a minute and try again.'
      else if (result.status === 403) message.value = 'Please complete a new verification and try again.'
      throw new Error('Signup failed')
    }
    const body = await result.json()
    if (body.accepted !== true) throw new Error('Unexpected response')
    accepted.value = true
    email.value = ''
    consent.value = false
    ++attempt
    if (widgetId !== undefined) turnstile?.remove(widgetId)
    widgetId = undefined
    await nextTick()
    success.value?.focus()
  } catch {
    if (!mounted.value) return
    if (!message.value) message.value = 'We couldn’t confirm your signup. Your email is still here—please try again.'
    void verify()
  } finally {
    window.clearTimeout(timer)
    token.value = ''
    busy.value = false
  }
}

onMounted(() => {
  mounted.value = true
  if (enabled.value) void verify()
})
onBeforeUnmount(() => {
  mounted.value = false
  ++attempt
  controller?.abort()
  if (widgetId !== undefined) turnstile?.remove(widgetId)
})
</script>

<template>
  <section v-if="enabled" class="mt-8 w-full max-w-md sm:mt-10" aria-labelledby="signup-heading">
    <h2 id="signup-heading" class="text-sm font-bold">Be first to hear what’s growing.</h2>
    <p v-if="accepted" ref="success" tabindex="-1" role="status" class="mt-4 rounded-xl border border-tomato/40 px-5 py-5 text-sm leading-relaxed focus:outline-2 focus:outline-offset-4 focus:outline-tomato">
      Thanks! Your signup request is received. Keep an eye on your inbox for news from Big Naturals Food Co.
    </p>
    <form v-else class="mt-4 text-left" :aria-busy="busy" @submit.prevent="submit">
      <label for="signup-email" class="mb-2 block text-xs font-bold">Email address</label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <input id="signup-email" v-model="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" :spellcheck="false" maxlength="254" required :disabled="!mounted || busy" aria-describedby="signup-privacy signup-message" placeholder="you@example.com" class="min-w-0 flex-1 rounded-lg border border-tomato/50 bg-transparent px-4 py-3 text-base text-ink placeholder:text-ink/45 focus:outline-2 focus:outline-offset-2 focus:outline-tomato">
        <button type="submit" :disabled="!mounted || busy || !token || !consent" class="rounded-lg bg-tomato px-6 py-3 text-sm font-bold text-cream focus:outline-2 focus:outline-offset-2 focus:outline-tomato disabled:cursor-not-allowed disabled:opacity-50">
          {{ busy ? 'Signing up…' : 'Keep me posted' }}
        </button>
      </div>
      <div class="signup-decoy" aria-hidden="true" inert>
        <label for="signup-name">Leave this empty</label>
        <input id="signup-name" v-model="name" name="name" tabindex="-1" autocomplete="off" type="text">
      </div>
      <label class="mt-4 flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-ink/80">
        <input v-model="consent" name="consent" type="checkbox" required :disabled="!mounted || busy" class="mt-0.5 size-4 shrink-0 accent-tomato focus:outline-2 focus:outline-offset-2 focus:outline-tomato">
        <span>I’d like email updates from Big Naturals Food Co. I can unsubscribe anytime.</span>
      </label>
      <p id="signup-privacy" class="mt-2 text-xs leading-relaxed text-ink/65">We use Brevo to manage email updates and Cloudflare Turnstile to prevent spam.</p>
      <div class="mt-3 flex flex-col items-center gap-2">
        <div ref="challenge" />
        <p v-if="verificationMessage" role="status" class="text-center text-xs leading-relaxed text-ink/75">{{ verificationMessage }}</p>
        <button v-if="verificationFailed" type="button" :disabled="busy" class="rounded px-3 py-2 text-xs font-bold underline underline-offset-4 focus:outline-2 focus:outline-tomato" @click="verify">Retry verification</button>
      </div>
      <p id="signup-message" role="alert" class="mt-2 text-center text-sm leading-relaxed">{{ message }}</p>
      <p v-if="!mounted" class="mt-3 text-center text-sm">Please enable JavaScript to sign up for email updates.</p>
    </form>
  </section>
  <span v-else class="mt-8 rounded-full border border-tomato px-6 py-2.5 text-xs font-bold tracking-[0.16em] sm:mt-10">COMING SOON</span>
</template>

<style scoped>
.signup-decoy { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
