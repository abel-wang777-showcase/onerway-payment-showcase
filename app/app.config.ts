import base from './config/foundation/app'

export default defineAppConfig({
  ...base,
  ui: {
    ...base.ui,
    colors: {
      ...base.ui.colors,
    },
  },
})
