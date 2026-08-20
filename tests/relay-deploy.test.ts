import { describe, expect, it } from 'vitest'
import { assertRelayDeployState, assertRelayMainSha } from '../scripts/relay.mjs'

describe('Relay production deployment gate', () => {
  it('accepts a clean exact origin/main checkout', () => {
    expect(() => assertRelayDeployState({
      status: '',
      head: 'exact-sha',
      main: 'exact-sha',
    })).not.toThrow()
  })

  it('rejects uncommitted changes', () => {
    expect(() => assertRelayDeployState({
      status: ' M relay/pages/_worker.js',
      head: 'exact-sha',
      main: 'exact-sha',
    })).toThrow('RELAY_DEPLOY_WORKTREE_DIRTY')
  })

  it('rejects a head that is not current origin/main', () => {
    expect(() => assertRelayDeployState({
      status: '',
      head: 'feature-sha',
      main: 'main-sha',
    })).toThrow('RELAY_DEPLOY_HEAD_MISMATCH')
  })

  it('rejects an invalid current main revision', () => {
    expect(() => assertRelayMainSha('not-a-sha')).toThrow('RELAY_DEPLOY_MAIN_INVALID')
  })
})
