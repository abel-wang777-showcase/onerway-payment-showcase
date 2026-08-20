export interface ErrorView {
  title: string
  description: string
}

export function getErrorView(statusCode: number): ErrorView {
  if (statusCode === 404) {
    return {
      title: 'Page not found',
      description: 'The page you requested is not part of this showcase.',
    }
  }

  return {
    title: 'Something went wrong',
    description: 'The showcase could not load this page. Please return home and try again.',
  }
}
