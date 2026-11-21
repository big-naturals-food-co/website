<script setup lang="ts">
const copyrightYear = new Date().getFullYear()

useHead({ link: [
  { rel: 'icon', type: 'image/png', href: '/favicon.png' },
  { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
] })
</script>

<template>
  <div class="site-shell">
    <a class="skip-link" href="#main">Skip to content</a>
    <SiteHeader />
    <NuxtPage />
    <footer class="site-footer">
      <span>© {{ copyrightYear }} Big Naturals Food Co., LLC</span>
    </footer>
  </div>
</template>
