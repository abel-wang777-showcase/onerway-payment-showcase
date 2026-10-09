const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function stringFields(value: unknown, names: readonly string[]): boolean {
  return record(value) && Object.entries(value).every(([key, item]) => names.includes(key) && typeof item === 'string')
}

// Reject unexpected fields in the debug copy without modifying the payment token.
export function canDisplayApplePayToken(token: Record<string, unknown>, serialized: string): boolean {
  if (new TextEncoder().encode(serialized).length > 65_536
    || Object.keys(token).some(key => !['paymentData', 'paymentMethod', 'transactionIdentifier'].includes(key))
    || typeof token.transactionIdentifier !== 'string'
    || !stringFields(token.paymentMethod, ['displayName', 'network', 'type'])
    || !record(token.paymentData)) return false
  return Object.entries(token.paymentData).every(([key, value]) => key === 'header'
    ? stringFields(value, ['ephemeralPublicKey', 'publicKeyHash', 'transactionId', 'applicationData', 'wrappedKey'])
    : ['version', 'data', 'signature'].includes(key) && typeof value === 'string')
}

export function applePayTokenFormats(serialized: string) {
  const tokenInfo = { provider: 'ApplePay', tokenId: serialized }
  return {
    json: JSON.stringify(JSON.parse(serialized), null, 2),
    // Render the string as a JSON value, including quotes and escaping, for pasting.
    stringify: JSON.stringify(serialized),
    apifox: JSON.stringify({ tokenInfo }, null, 2),
    direct: JSON.stringify({ tokenInfo: JSON.stringify(tokenInfo) }, null, 2),
  }
}
