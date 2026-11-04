import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },
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
        { name: 'theme-color', content: '#f6f1df' },
        { property: 'og:title', content: 'Big Naturals Food Co.' },
        { property: 'og:description', content: 'Something good is growing. Coming soon.' },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  nitro: {
    preset: 'static',
    prerender: {
      crawlLinks: false,
      failOnError: true,
      routes: ['/'],
      ignore: ['/200.html', '/404.html'],
    },
  },
  typescript: { strict: true },
})
