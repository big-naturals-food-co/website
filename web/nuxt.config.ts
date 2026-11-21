import tailwindcss from '@tailwindcss/vite'
import signupSettings from '../cloud/signup.json'
import project from '../cloud/aws/project.json'
import { parseSignupConfig } from '../cloud/aws/lib/signup-config'

const signup = parseSignupConfig(signupSettings)
const localSignupMock = process.env.BNFC_DEV_SIGNUP_MOCK === 'true'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },
  $development: {
    ...(process.env.BNFC_E2E === 'true' ? { buildDir: '.nuxt/e2e' } : {}),
    runtimeConfig: {
      localSignupMock,
      public: {
        signupEndpoint: localSignupMock ? '/api/dev-signup' : `https://api.${project.domainName}/subscribe`,
        turnstileSiteKey: process.env.BNFC_DEV_TURNSTILE_SITE_KEY || signup.turnstileSiteKey,
      },
    },
  },
  runtimeConfig: {
    localSignupMock: false,
    public: {
      signupEnabled: signup.enabled,
      signupEndpoint: `https://api.${project.domainName}/subscribe`,
      turnstileSiteKey: signup.turnstileSiteKey,
    },
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Big Naturals Food Co. — Coming Soon',
      meta: [
        {
          name: 'description',
          content: 'Something good is growing. Big Naturals Food Co. Coming soon.',
        },
        { name: 'theme-color', content: '#BDF3FF' },
        { property: 'og:title', content: 'Big Naturals Food Co.' },
        { property: 'og:description', content: 'Something good is growing. Coming soon.' },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary' },
      ],
    },
  },
  nitro: {
    preset: 'static',
    prerender: {
      crawlLinks: false,
      failOnError: true,
      routes: ['/', '/goose-nibbles'],
      ignore: ['/200.html', '/404.html'],
    },
  },
  typescript: { strict: true },
})
