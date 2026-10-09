import type { GooglePayConfiguration } from '#shared/payment/google-pay'

export interface GooglePaymentsClient {
  isReadyToPay(request: object): Promise<{ result: boolean }>
  loadPaymentData(request: object): Promise<{ paymentMethodData?: { tokenizationData?: { token?: unknown } } }>
  createButton(options: { onClick: () => void, buttonColor: string, buttonType: string, buttonSizeMode: string }): HTMLElement
}
type GoogleWindow = Window & { google?: { payments?: { api?: { PaymentsClient: new (options: { environment: 'TEST' }) => GooglePaymentsClient } } } }
let loading: Promise<void> | undefined
export async function loadGooglePay(): Promise<GooglePaymentsClient> {
  if (!(window as GoogleWindow).google?.payments?.api) {
    loading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://pay.google.com/gp/p/js/pay.js'
      script.async = true
      const timer = setTimeout(() => { script.remove(); reject(new Error('GOOGLE_PAY_LOAD_TIMEOUT')) }, 15000)
      script.onload = () => { clearTimeout(timer); resolve() }
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('GOOGLE_PAY_LOAD_FAILED')) }
      document.head.append(script)
    }).catch((error: unknown) => { loading = undefined; throw error })
    await loading
  }
  const Constructor = (window as GoogleWindow).google?.payments?.api?.PaymentsClient
  if (!Constructor) throw new Error('GOOGLE_PAY_UNAVAILABLE')
  return new Constructor({ environment: 'TEST' })
}
export function googlePayRequests(config: GooglePayConfiguration) {
  const method = { type: 'CARD', parameters: { allowedAuthMethods: [...config.allowedAuthMethods], allowedCardNetworks: [...config.allowedCardNetworks] } }
  return {
    ready: { apiVersion: 2, apiVersionMinor: 0, allowedPaymentMethods: [method] },
    payment: { apiVersion: 2, apiVersionMinor: 0, allowedPaymentMethods: [{ ...method, tokenizationSpecification: { type: 'PAYMENT_GATEWAY', parameters: { gateway: config.gateway, gatewayMerchantId: config.gatewayMerchantId } } }], transactionInfo: { countryCode: config.countryCode, currencyCode: config.currencyCode, totalPriceStatus: 'FINAL', totalPrice: config.totalPrice }, merchantInfo: { merchantName: 'Halden' } },
  }
}
