// Display aliases only: stored order names and Provider plan projections stay immutable.
const productNames: Readonly<Record<string, string>> = {
  'Halden sample': 'Onerway Store sample',
  'Halden reservation': 'Onerway Store reservation',
  'Halden Daily Essentials': 'Onerway Store Daily Essentials',
}

export function storeProductName(name: string): string {
  return productNames[name] ?? name
}
