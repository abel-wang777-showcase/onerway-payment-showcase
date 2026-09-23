import base from './app/config/foundation/nuxt'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-28',

  devtools: {
    enabled: false,
  },

  app: {
    head: {
      htmlAttrs: {
        lang: 'en',
      },
    },
  },

  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
  ],

  css: [
    '~/assets/css/main.css',
    '~/assets/css/app.css',
  ],

  colorMode: {
    ...base.colorMode,
  },

  fonts: {
    provider: 'local',
    families: [
      { name: 'Geist', provider: 'none' },
      { name: 'Geist Mono', provider: 'none' },
    ],
  },

  icon: {
    fallbackToApi: false,
    clientBundle: {
      icons: ['lucide:package-check', 'lucide:refresh-cw', 'lucide:external-link'],
    },
  },

  ui: {
    ...base.ui,
    theme: {
      ...base.ui.theme,
    },
  },
})
