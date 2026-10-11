import base from './config/foundation/app'

export default defineAppConfig({
  ...base,
  ui: {
    ...base.ui,
    colors: {
      ...base.ui.colors,
    },
    button: {
      variants: {
        // Icon-only controls stay centered when their touch target grows.
        square: { true: 'justify-center' },
      },
    },
  },
})
