import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SHA_PATTERN = /^[0-9a-f]{40}$/

export function assertRelayDeployState({ status, head, main }) {
  if (status.trim()) {
    throw new Error('RELAY_DEPLOY_WORKTREE_DIRTY')
  }

  if (head !== main) {
    throw new Error('RELAY_DEPLOY_HEAD_MISMATCH')
  }
}

export function assertRelayMainSha(sha) {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error('RELAY_DEPLOY_MAIN_INVALID')
  }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function mainSha() {
  const expected = process.env.RELAY_MAIN_SHA?.trim()

  if (expected) {
    assertRelayMainSha(expected)

    return expected
  }

  execFileSync('git', ['fetch', 'origin', 'main:refs/remotes/origin/main'], { stdio: 'inherit' })
  return git('rev-parse', 'origin/main')
}

function deploy() {
  const main = mainSha()

  const head = git('rev-parse', 'HEAD')

  assertRelayDeployState({
    status: git('status', '--porcelain'),
    head,
    main,
  })

  execFileSync('pnpm', [
    'exec',
    'wrangler',
    'pages',
    'deploy',
    '--cwd',
    'relay',
    '--project-name',
    'onerway-showcase-relay',
    '--branch',
    'main',
    '--commit-hash',
    head,
    '--commit-dirty=false',
  ], { stdio: 'inherit' })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  deploy()
}
