<script setup lang="ts">
import manifest from '../../data/goose-nibbles.json'
import mascot from '~/assets/brand/bnfc_mascot.jpg'
import barPlaceholder from '~/assets/brand/granola-bar-placeholder.svg'

const backgrounds = ['coral', 'sky', 'leaf']
const flavorSubtitles: Record<string, string> = {
  'Violet’s Demise': 'Blueberry Flavor',
  'Eve Did It': 'Apple Flavor',
}
const flavors = manifest.flavors.map((flavor, index) => ({
  ...flavor,
  subtitle: flavorSubtitles[flavor.name],
  id: flavor.name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-'),
  background: backgrounds[index % backgrounds.length],
}))

useSeoMeta({
  title: 'Goose Nibbles — Big Naturals Food Co.',
  description: 'Meet Goose Nibbles: Cranberry Caboodle, Violet’s Demise, and Eve Did It. Explore the ingredients in each granola bar flavor.',
  ogTitle: 'Goose Nibbles — Big Naturals Food Co.',
  ogDescription: 'Three granola bar flavors. Find the ingredients in your Goose Nibbles.',
})
useHead({ link: [{ rel: 'canonical', href: 'https://bignaturalsfoodco.com/goose-nibbles' }] })
</script>

<template>
  <main id="main" class="nibbles-main">
    <header class="nibbles-intro">
      <p class="nibbles-eyebrow">Meet our granola bars</p>
      <h1 class="nibbles-title">Goose Nibbles</h1>
      <nav class="flavor-links" aria-label="Jump to a flavor">
        <a v-for="flavor in flavors" :key="flavor.id" :href="`#${flavor.id}`">{{ flavor.name }}</a>
      </nav>
    </header>

    <section v-for="flavor in flavors" :id="flavor.id" :key="flavor.id" class="flavor-section" :class="`flavor-section--${flavor.background}`" :aria-labelledby="`${flavor.id}-title`">
      <div class="flavor-content">
        <div class="flavor-heading">
          <img class="flavor-avatar" :src="mascot" alt="" width="1600" height="1600" loading="lazy">
          <div>
            <h2 :id="`${flavor.id}-title`">{{ flavor.name }}</h2>
            <p v-if="flavor.subtitle" class="flavor-subtitle">{{ flavor.subtitle }}</p>
          </div>
        </div>
        <p class="flavor-ingredients"><strong>Ingredients:</strong> {{ flavor.ingredients.join(', ') }}.</p>
        <figure class="flavor-photo">
          <img :src="barPlaceholder" alt="Illustrated placeholder for a single granola bar." width="480" height="280" loading="lazy">
          <figcaption>Bar photo coming soon.</figcaption>
        </figure>
      </div>
    </section>

    <div class="nibbles-closing">
      <p class="nutrition-notice">Nutrition information is not yet available.</p>
      <div class="nibbles-signup">
        <SignupPanel />
      </div>
    </div>
  </main>
</template>
