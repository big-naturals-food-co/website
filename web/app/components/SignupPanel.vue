<script setup lang="ts">
import goose from '~/assets/brand/bnfc_icon.png'

withDefaults(defineProps<{ headingTag?: 'h1' | 'h2' }>(), { headingTag: 'h2' })
</script>

<template>
  <div id="email-updates" class="signup-panel">
    <div class="signup-panel-art">
      <img :src="goose" alt="Our goose spreading its wings above a rocky green hillside." width="1600" height="1600">
    </div>
    <div class="signup-panel-content">
      <component :is="headingTag" class="signup-panel-heading">The goose will<br>soon be loose!</component>
      <p class="signup-panel-description">Bringing big goose energy to natural foods and whole ingredients.</p>
      <SignupForm />
    </div>
  </div>
</template>

<style scoped>
.signup-panel { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: clamp(2rem, 5vw, 5rem); }
.signup-panel-art img { display: block; width: 100%; height: auto; }
.signup-panel-content { padding: 2rem; border-radius: 1.5rem; background: var(--color-leaf); }
.signup-panel-heading { font-family: var(--font-display); font-weight: 400; font-size: clamp(2rem, 3.4vw, 3rem); line-height: 1.08; text-wrap: balance; }
.signup-panel-description { margin-top: .75rem; font-size: 1rem; line-height: 1.6; }

@media (max-width: 767px) {
  .signup-panel { grid-template-columns: 1fr; gap: 1.5rem; }
  .signup-panel-art { width: min(70%, 280px); margin-inline: auto; }
  .signup-panel-content { padding: 1.5rem; }
  .signup-panel-heading { font-size: 2.25rem; }
}
</style>
