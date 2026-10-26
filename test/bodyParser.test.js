import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('body-parser resolves to the fixed version (>= 2.4.0)', () => {
  const lock = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
  )
  const bodyParser = lock.packages['node_modules/body-parser']

  assert.ok(bodyParser, 'body-parser must be present in the lockfile')

  const [major, minor] = bodyParser.version.split('.').map(Number)
  assert.ok(
    major > 2 || (major === 2 && minor >= 4),
    `body-parser ${bodyParser.version} is affected by GHSA-27r3-jxmh-p828; require >= 2.4.0`
  )
})
