import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  files: ['app/error.vue'],
  rules: {
    'vue/multi-word-component-names': 'off',
  },
}, {
  files: ['app/components/CopyButton.vue'],
  rules: {
    // Registry props delegate optional toast text to useCopy's defaults.
    'vue/require-default-prop': 'off',
  },
})
