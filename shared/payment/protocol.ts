export type PaymentNetworkIcon
  = | 'i-simple-icons-visa'
    | 'i-simple-icons-mastercard'
    | 'i-simple-icons-americanexpress'
    | 'i-simple-icons-discover'
    | 'i-simple-icons-jcb'
    | 'i-lucide-credit-card'

export interface PaymentNetworkEvidence {
  readonly value: string
  readonly icon: PaymentNetworkIcon
}

export interface PaymentEvidenceField {
  readonly label: string
  readonly value: string
  readonly networks?: readonly PaymentNetworkEvidence[]
}

export interface PaymentEvidence {
  readonly summary: string
  readonly source: 'live' | 'stored'
  readonly fields: readonly PaymentEvidenceField[]
  readonly request?: string
  readonly response?: string
  readonly occurredAt?: string
  readonly durationMs?: number
}
export type PaymentStepState = 'waiting' | 'active' | 'completed' | 'interrupted'
export interface PaymentStep {
  readonly id: string
  readonly title: string
  readonly actor: string
  readonly input: string
  readonly output: string
  readonly failure: string
  readonly documentation: string
  readonly evidence?: PaymentEvidence
  readonly example?: { readonly request?: string, readonly response?: string, readonly language?: 'js' | 'json' }
  readonly state: PaymentStepState
}

export interface ProtocolActor {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly merchant?: boolean
}
export interface ProtocolEdge {
  readonly from: string
  readonly to: string
  readonly label: string
  readonly detail?: string
}
export interface ProtocolFlow {
  readonly id: string
  readonly title: string
  readonly trigger: string
  readonly edges: readonly ProtocolEdge[]
  readonly client: string
  readonly server: string
  readonly note: string
  readonly clientCode?: string
  readonly serverCode?: string
}
