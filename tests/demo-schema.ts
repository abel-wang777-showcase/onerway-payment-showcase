import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { AnySchema, ValidateFunction } from 'ajv'
import document from '../docs/api/demo-v1.openapi.json'

type Schema = Record<string, unknown>
interface Reference { $ref: string }
interface Parameter { name: string, in: string, required?: boolean, schema: Schema }
interface Content { 'application/json'?: { schema: Schema } }
interface Response { headers?: Record<string, { schema: Schema }>, content?: Content }
interface Operation {
  parameters?: (Parameter | Reference)[]
  requestBody?: { required?: boolean, content: Content }
  responses: Record<string, Response | Reference>
}
const api = document as unknown as { paths: Record<string, Record<string, Operation>> }
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validators = new Map<string, ValidateFunction>()

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function resolve<T>(value: T | Reference): T {
  if (value && typeof value === 'object' && '$ref' in value) {
    const ref = (value as Reference).$ref
    assert(ref.startsWith('#/'), `Unsupported external reference: ${ref}`)
    let resolved: unknown = document
    for (const part of ref.slice(2).split('/')) {
      resolved = (resolved as Record<string, unknown>)[part.replaceAll('~1', '/').replaceAll('~0', '~')]
    }
    assert(resolved !== undefined, `Unresolved reference: ${ref}`)
    return resolved as T
  }
  return value as T
}

function validate(schema: Schema, value: unknown, label: string) {
  const key = JSON.stringify(schema)
  let validator = validators.get(key)
  if (!validator) {
    validator = ajv.compile({ ...schema, components: document.components } as AnySchema)
    validators.set(key, validator)
  }
  assert(validator(value), `${label}: ${ajv.errorsText(validator.errors, { separator: '; ' })}`)
}

function operation(path: string, method: string): Operation {
  const found = api.paths[path]?.[method.toLowerCase()]
  assert(found, `Undeclared operation: ${method} ${path}`)
  return found
}

function headerValue(headers: Record<string, unknown>, name: string) {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

/** Validates server output strictly; clients intentionally tolerate unknown response fields. */
export function assertDemoSchema(name: string, value: unknown) {
  assert(name in document.components.schemas, `Undeclared schema: ${name}`)
  validate({ $ref: `#/components/schemas/${name}` }, value, name)
}

export function assertDemoRequest(path: string, method: string, request: {
  body?: unknown
  parameters?: Record<string, unknown>
  headers?: Record<string, unknown>
}) {
  const spec = operation(path, method)
  for (const item of spec.parameters ?? []) {
    const parameter = resolve<Parameter>(item)
    const value = parameter.in === 'header'
      ? headerValue(request.headers ?? {}, parameter.name)
      : request.parameters?.[parameter.name]
    if (value === undefined) assert(!parameter.required, `Missing request ${parameter.name}`)
    else validate(parameter.schema, value, `Request ${parameter.name}`)
  }
  const body = spec.requestBody
  if (request.body !== undefined) {
    assert(body?.content['application/json'], 'Undeclared request body')
    validate(body.content['application/json'].schema, request.body, 'Request body')
  }
  else assert(!body?.required, 'Missing required request body')
}

/** Pass the OpenAPI template path, not a URL with concrete resource identifiers. */
export function assertDemoResponse(
  path: string,
  method: string,
  status: number,
  body: unknown,
  headers: Record<string, unknown>,
  options: { authenticated?: boolean } = {},
) {
  const declared = operation(path, method).responses[String(status)]
  assert(declared, `Undeclared response status: ${method} ${path} ${status}`)
  const response = resolve<Response>(declared)
  const schema = response.content?.['application/json']?.schema
  if (schema) validate(schema, body, 'Response body')
  else assert(body === undefined || body === null || body === '', 'Response must have no body')
  assert(headerValue(headers, 'Cache-Control') === 'no-store', 'Response must be no-store')
  for (const [name, header] of Object.entries(response.headers ?? {})) {
    let value = headerValue(headers, name)
    if (value === undefined) continue
    // HTTP headers are strings; integer-seconds Retry-After is described as an integer in OpenAPI.
    if (header.schema.type === 'integer' && typeof value === 'string' && /^\d+$/.test(value)) value = Number(value)
    validate(header.schema, value, `Response header ${name}`)
  }
  const expiresAt = headerValue(headers, 'X-Demo-Session-Expires-At')
  const authenticated = options.authenticated ?? (path !== '/connection' && path !== '/sessions' && status !== 401 && status !== 503)
  if (authenticated || (path === '/sessions' && status === 201)) {
    assert(expiresAt !== undefined, 'Authenticated response must expose persisted session expiry')
    validate({ type: 'string', format: 'date-time', pattern: 'Z$' }, expiresAt, 'Session expiry')
  }
  if (status === 401 || path === '/connection') assert(expiresAt === undefined, 'Unauthenticated response must not claim session renewal')
  if (status === 429) {
    const error = (body as { error: { retryAfter: number, execution: string } }).error
    assert(error.execution === 'not_started', 'Application rate limit must be not_started')
    assert(Number(headerValue(headers, 'Retry-After')) === error.retryAfter, 'Retry-After must match error.retryAfter')
  }
}
