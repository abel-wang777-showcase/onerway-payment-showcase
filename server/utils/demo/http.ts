import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { AnySchema, ValidateFunction } from 'ajv'
import { getHeader, getQuery, getRequestURL, removeResponseHeader, setResponseHeader, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import api from '../../../docs/api/demo-v1.openapi.json'
import type { CustomerCreate, PaymentCreate, CheckoutSessionCreate, SessionCreate, CurrentCustomerSet, Platform } from '../../../shared/payment/demo'
import { requireServerProfile } from '../profile'
import { DEMO_REVISION, demoCapabilities } from './capability'
import { demoTransaction } from './database'
import { DemoError, invalidDemoField } from './errors'
import {
  authenticateDemoSession, createDemoSession, getDemoSession, createDemoCustomer,
  setCurrentCustomer, listDemoCustomers, consumeDemoLimit, normalizeCustomerLabel,
  type DemoSession,
} from './identity'
import { createDemoPayment, getDemoPayment, recoverDemoPayment, listDemoPayments } from './payment'
import { createDemoCheckout, releaseDemoCheckout, getDemoOperation } from './lease'

type Schema = Record<string, unknown>
interface Parameter { name: string, in: string, required?: boolean, schema: Schema }
interface Spec { parameters?: (Parameter | { $ref: string })[], requestBody?: { content: { 'application/json': { schema: Schema } } } }
const paths = api.paths as unknown as Record<string, Record<string, Spec>>
const ajv = new Ajv2020({ strict: false, allErrors: false })
addFormats(ajv)
const validators = new Map<string, ValidateFunction>()
const BODY_LIMIT = 16 * 1024

function validate(schema: Schema, value: unknown, field: string) {
  const key = JSON.stringify(schema)
  let validator = validators.get(key)
  if (!validator) {
    validator = ajv.compile({ ...schema, components: api.components } as AnySchema)
    validators.set(key, validator)
  }
  if (!validator(value)) invalidDemoField(field, 'FIELD_INVALID')
}

export function demoMinimumBuild(platform: Platform): number {
  const value = process.env[`DEMO_MIN_CLIENT_BUILD_${platform}`]
  if (value === undefined || value === '') return 0
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new DemoError(503, 'CONFIGURATION_UNAVAILABLE')
  return Number(value)
}

function parseClient(event: H3Event) {
  const match = /^(ANDROID|IOS|WEB)\/(\d+)$/.exec(getHeader(event, 'x-demo-client') ?? '')
  if (!match || !Number.isSafeInteger(Number(match[2]))) invalidDemoField('X-Demo-Client', 'FIELD_INVALID')
  const platform = match[1] as Platform
  const clientBuild = Number(match[2])
  return { platform, clientBuild, compatible: clientBuild >= demoMinimumBuild(platform) }
}

function sandboxProfile() {
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') throw new DemoError(503, 'SANDBOX_UNAVAILABLE')
  return profile
}

function sessionView(session: DemoSession) {
  return { sessionRef: session.id, currentCustomerId: session.currentCustomerId, capabilitiesRevision: DEMO_REVISION }
}

function matchOperation(event: H3Event) {
  const pathname = getRequestURL(event).pathname
  const path = pathname.replace(/^\/api\/demo\/v1(?=\/|$)/, '')
  for (const [template, methods] of Object.entries(paths)) {
    const names = [...template.matchAll(/\{([^}]+)\}/g)].map(match => match[1]!)
    const match = new RegExp(`^${template.replace(/\{[^}]+\}/g, '([^/]+)')}/?$`).exec(path)
    if (!match) continue
    const spec = methods[event.method.toLowerCase()]
    if (!spec) throw new DemoError(404, 'RESOURCE_UNAVAILABLE')
    const parameters: Record<string, string> = {}
    try { names.forEach((name, index) => { parameters[name] = decodeURIComponent(match[index + 1]!) }) }
    catch { invalidDemoField('path') }
    return { template, spec, parameters }
  }
  throw new DemoError(404, 'RESOURCE_UNAVAILABLE')
}

/** Bound the stream before parsing; never retain a body containing unexpected payment fields. */
async function readJson(event: H3Event): Promise<unknown> {
  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') invalidDemoField('Content-Type', 'FIELD_INVALID')
  const declared = getHeader(event, 'content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) invalidDemoField('body', 'BODY_TOO_LARGE')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > BODY_LIMIT) invalidDemoField('body', 'BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { invalidDemoField('body', 'FIELD_INVALID') }
}

function normalizedBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const value = body as Record<string, unknown>
  if (typeof value.label === 'string') value.label = normalizeCustomerLabel(value.label)
  const customer = value.customer
  if (customer && typeof customer === 'object' && 'kind' in customer && customer.kind === 'new' && 'label' in customer && typeof customer.label === 'string') {
    customer.label = normalizeCustomerLabel(customer.label)
  }
  return body
}

/** Compare ASCII credential values even through repeated percent encoding, without logging either input. */
function containsCredential(url: string, credential: string): boolean {
  let decoded = url
  while (true) {
    if (decoded.includes(credential)) return true
    // A malformed escape elsewhere must not prevent decoding an encoded credential.
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    if (next === decoded) return false
    decoded = next
  }
}

export async function handleDemoRequest(event: H3Event): Promise<unknown> {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Access-Control-Expose-Headers', 'X-Demo-Session-Expires-At, Retry-After')
  let operationId: string | null = null
  let writeDispatched = false
  try {
    const route = matchOperation(event)
    const anonymous = route.template === '/connection' || route.template === '/sessions'
    let session: DemoSession | undefined
    let bearerToken: string | null = null
    if (!anonymous) {
      const authorization = getHeader(event, 'authorization')
      bearerToken = authorization ? /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)?.[1] ?? 'invalid' : null
      session = await authenticateDemoSession(bearerToken)
      setResponseHeader(event, 'X-Demo-Session-Expires-At', session.expiresAt)
    }
    const client = parseClient(event)
    if (session && session.platform !== client.platform) invalidDemoField('X-Demo-Client', 'PLATFORM_MISMATCH')
    const query = getQuery(event) as Record<string, unknown>
    const allowedQuery = new Set<string>()
    for (const reference of route.spec.parameters ?? []) {
      const parameter = '$ref' in reference
        ? api.components.parameters[reference.$ref.split('/').at(-1) as keyof typeof api.components.parameters] as Parameter
        : reference
      if (parameter.in === 'header') continue
      if (parameter.in === 'query') allowedQuery.add(parameter.name)
      const values = parameter.in === 'path' ? route.parameters : query
      let value = values[parameter.name]
      if (parameter.schema.type === 'integer' && typeof value === 'string' && /^\d+$/.test(value)) {
        value = Number(value)
        query[parameter.name] = value
      }
      if (value === undefined && !parameter.required) continue
      validate(parameter.schema, value, parameter.name)
    }
    if (Object.keys(query).some(key => !allowedQuery.has(key))) invalidDemoField('query', 'FIELD_INVALID')
    let body: unknown
    if (route.spec.requestBody) {
      body = normalizedBody(await readJson(event))
      validate(route.spec.requestBody.content['application/json'].schema, body, 'body')
      if (route.template === '/payments' && bearerToken) {
        const target = (body as PaymentCreate).returnTarget
        if (target.kind === 'custom' && containsCredential(target.url, bearerToken)) {
          invalidDemoField('returnTarget.url', 'FIELD_INVALID')
        }
      }
    }
    else if (['POST', 'PUT', 'DELETE'].includes(event.method) && (Number(getHeader(event, 'content-length') ?? 0) > 0 || getHeader(event, 'transfer-encoding'))) {
      invalidDemoField('body', 'FIELD_INVALID')
    }
    const key = `${event.method} ${route.template}`
    if (['POST /customers', 'POST /payments', 'POST /payments/{id}/checkout-session'].includes(key)) {
      const input = body as { requestId?: string, operationId?: string }
      operationId = input.requestId ?? input.operationId ?? null
    }
    const respond = (result: { status: number, body: unknown }) => {
      setResponseStatus(event, result.status)
      return result.body
    }
    if (key === 'GET /connection') {
      if (query.platform !== client.platform || query.clientBuild !== client.clientBuild) invalidDemoField('X-Demo-Client', 'CLIENT_MISMATCH')
      const profile = sandboxProfile()
      return { environment: 'sandbox', apiVersion: 'v1', minimumClientBuild: demoMinimumBuild(client.platform), compatible: client.compatible, capabilitiesRevision: DEMO_REVISION, sdk: { merchantNo: profile.merchantNo, environment: 'sandbox', configRevision: DEMO_REVISION } }
    }
    if (key === 'POST /sessions') {
      const input = body as SessionCreate
      if (input.platform === 'WEB') invalidDemoField('platform', 'FIELD_INVALID')
      if (input.platform !== client.platform || input.clientBuild !== client.clientBuild) invalidDemoField('X-Demo-Client', 'CLIENT_MISMATCH')
      sandboxProfile()
      // Forwarded headers are client-controlled without a trusted runtime contract; use the persistent global bucket.
      await demoTransaction(db => consumeDemoLimit(db, 'session_create:global', 120, 60))
      const issued = await createDemoSession(input.platform)
      setResponseHeader(event, 'X-Demo-Session-Expires-At', issued.session.expiresAt)
      return respond({ status: 201, body: { sessionRef: issued.session.id, sessionToken: issued.sessionToken } })
    }
    if (!session) throw new DemoError(401, 'SESSION_MISSING')
    switch (key) {
      case 'GET /session': return sessionView(await getDemoSession(session.id))
      case 'POST /session/renew': setResponseStatus(event, 204); return null
      case 'PUT /session/current-customer': return sessionView(await setCurrentCustomer(session.id, (body as CurrentCustomerSet).customerId))
      case 'GET /capabilities': return demoCapabilities()
      case 'POST /customers': writeDispatched = true; return respond(await createDemoCustomer(session.id, body as CustomerCreate, { compatible: client.compatible }))
      case 'GET /customers': return await listDemoCustomers(session.id, query)
      case 'POST /payments': writeDispatched = true; return respond(await createDemoPayment(session, body as PaymentCreate, sandboxProfile(), client.compatible))
      case 'GET /payments': return await listDemoPayments(session.id, query, sandboxProfile())
      case 'GET /payment-requests/{requestId}': return await recoverDemoPayment(session.id, route.parameters.requestId!, sandboxProfile())
      case 'GET /payments/{id}': return await getDemoPayment(session.id, route.parameters.id!, sandboxProfile())
      case 'POST /payments/{id}/refresh': return await getDemoPayment(session.id, route.parameters.id!, sandboxProfile(), { refresh: true })
      case 'POST /payments/{id}/checkout-session': writeDispatched = true; return respond(await createDemoCheckout(session, route.parameters.id!, body as CheckoutSessionCreate, sandboxProfile(), client.compatible))
      case 'DELETE /payments/{id}/checkout-sessions/{checkoutSessionId}':
        await releaseDemoCheckout(session.id, route.parameters.id!, route.parameters.checkoutSessionId!)
        setResponseStatus(event, 204)
        return null
      case 'GET /operations/{operationId}': return await getDemoOperation(session.id, route.parameters.operationId!)
      default: throw new DemoError(404, 'RESOURCE_UNAVAILABLE')
    }
  }
  catch (error) {
    const failure = error instanceof DemoError ? error : new DemoError(503, 'SERVICE_UNAVAILABLE', { retryable: true, execution: writeDispatched ? 'unknown' : 'not_started', action: writeDispatched ? 'RECOVER_OPERATION' : 'RETRY_SAME_REQUEST', operationId: writeDispatched ? operationId : null })
    setResponseStatus(event, failure.statusCode)
    if (failure.statusCode === 401) removeResponseHeader(event, 'X-Demo-Session-Expires-At')
    if (failure.body.error.retryAfter !== null) setResponseHeader(event, 'Retry-After', failure.body.error.retryAfter)
    return failure.body
  }
}
