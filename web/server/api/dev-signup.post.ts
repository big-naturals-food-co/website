// Local preview only: never send, store, or log a submitted address.
export default defineEventHandler((event) => {
  if (!import.meta.dev || useRuntimeConfig(event).localSignupMock !== true) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { accepted: true }
})
