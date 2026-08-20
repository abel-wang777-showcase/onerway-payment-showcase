import { describe, expect, it } from 'vitest'
import { getErrorView } from '../app/utils/error'

describe('getErrorView', () => {
  it('returns a specific message for missing pages', () => {
    expect(getErrorView(404)).toEqual({
      title: 'Page not found',
      description: 'The page you requested is not part of this showcase.',
    })
  })

  it('uses a safe fallback for unexpected failures', () => {
    expect(getErrorView(500)).toEqual({
      title: 'Something went wrong',
      description: 'The showcase could not load this page. Please return home and try again.',
    })
  })
})
