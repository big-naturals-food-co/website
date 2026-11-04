<template>
  <div class="flex min-h-svh flex-col bg-cream text-tomato selection:bg-tomato selection:text-cream">
    <header class="mx-5 flex items-center justify-between gap-4 border-b border-tomato/30 py-5 sm:mx-10 sm:py-6 lg:mx-16">
      <span class="text-xs font-bold tracking-[0.18em] sm:text-sm">BIG NATURALS FOOD CO.</span>
      <span class="flex shrink-0 items-center gap-2 text-[0.65rem] font-bold tracking-[0.14em] sm:text-xs">
        <span aria-hidden="true" class="size-2 rounded-full bg-tomato" />
        COMING SOON
      </span>
    </header>

    <main id="main" class="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center sm:px-10 sm:py-16">
      <div aria-hidden="true" class="mb-6 flex items-center gap-4 sm:mb-8">
        <span class="h-px w-12 bg-tomato/40 sm:w-20" />
        <svg class="size-12 sm:size-14" viewBox="0 0 64 64" fill="none">
          <path d="M32 54V31M32 39C15 40 8 28 9 15c15-1 25 7 23 24ZM32 31C31 17 40 9 55 10c0 15-8 24-23 21Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="m18 24 14 15m0-8 14-12M23 55h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <span class="h-px w-12 bg-tomato/40 sm:w-20" />
      </div>

      <h1 class="wordmark w-full max-w-6xl" aria-label="Big Naturals Food Co.">
        <span aria-hidden="true" class="block text-[clamp(3.5rem,15vw,12rem)] leading-[0.78]">Big Naturals</span>
        <span aria-hidden="true" class="mt-5 block font-sans text-[clamp(0.9rem,2vw,1.5rem)] font-bold leading-normal tracking-[0.32em] sm:mt-7">FOOD CO.</span>
      </h1>

      <div class="mt-10 max-w-md sm:mt-14">
        <p class="font-serif text-2xl leading-snug sm:text-3xl">Something good is growing.</p>
        <p class="mt-3 text-sm leading-relaxed text-ink/75 sm:text-base">We’re just getting started. More soon.</p>
      </div>

      <span class="mt-8 rounded-full border border-tomato px-6 py-2.5 text-xs font-bold tracking-[0.16em] sm:mt-10">COMING SOON</span>
    </main>

    <footer class="mx-5 flex flex-col items-center justify-between gap-2 border-t border-tomato/30 py-5 text-[0.65rem] font-medium tracking-[0.12em] sm:mx-10 sm:flex-row sm:py-6 sm:text-xs lg:mx-16">
      <span>BIG NATURALS FOOD CO., LLC</span>
      <span>A LITTLE PATIENCE. SOMETHING GOOD.</span>
    </footer>
  </div>
</template>
