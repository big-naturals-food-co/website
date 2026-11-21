<script setup lang="ts">
import wordmark from '~/assets/brand/bnfc_wordmark.svg'

const menu = ref<HTMLDialogElement>()
const trigger = ref<HTMLButtonElement>()
const isOpen = ref(false)
const mounted = ref(false)
const route = useRoute()
let restoreKeyboardFocus = true
onMounted(() => { mounted.value = true })

function openMenu() {
  restoreKeyboardFocus = true
  menu.value?.showModal()
  menu.value?.focus({ preventScroll: true })
  isOpen.value = true
  document.documentElement.classList.add('navigation-open')
}

function closeMenu(event: MouseEvent) {
  restoreKeyboardFocus = event.detail === 0
  menu.value?.close()
}

function onClose() {
  isOpen.value = false
  document.documentElement.classList.remove('navigation-open')
  if (restoreKeyboardFocus) trigger.value?.focus({ preventScroll: true })
  else trigger.value?.blur()
}

function closeFromBackdrop(event: MouseEvent) {
  if (event.target !== menu.value || !menu.value) return
  const rect = menu.value.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMenu(event)
}

function keepFocusInMenu(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !menu.value) return
  const items = menu.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')
  const first = items[0]
  const last = items[items.length - 1]
  if (document.activeElement === menu.value) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

onBeforeUnmount(() => document.documentElement.classList.remove('navigation-open'))
</script>

<template>
  <header class="site-header">
    <a class="header-home" href="/" aria-label="Big Naturals Food Co. home">
      <img :src="wordmark" alt="Big Naturals Food Co." width="958" height="360" fetchpriority="high">
    </a>
    <div class="header-actions">
      <button ref="trigger" class="menu-button" type="button" aria-label="Open navigation" aria-controls="site-navigation" :aria-expanded="isOpen" :disabled="!mounted" @click="openMenu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <dialog id="site-navigation" ref="menu" class="navigation-dialog" aria-label="Main navigation" tabindex="-1" @close="onClose" @click="closeFromBackdrop" @keydown="keepFocusInMenu">
      <div class="navigation-heading">
        <span>Explore</span>
        <button class="menu-button" type="button" aria-label="Close navigation" @click="closeMenu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m5 5 14 14M19 5 5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <nav aria-label="Main navigation" class="navigation-links">
        <a href="/" :aria-current="route.path === '/' ? 'page' : undefined" @click="closeMenu">Home</a>
        <a href="/goose-nibbles" :aria-current="route.path.replace(/\/$/, '') === '/goose-nibbles' ? 'page' : undefined" @click="closeMenu">Goose Nibbles</a>
      </nav>
    </dialog>
  </header>
</template>
