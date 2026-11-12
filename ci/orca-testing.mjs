// CI stand-in for `orca/testing`: the pure tests only need Node's test runner and assert.
export { test, describe, beforeEach, afterEach } from 'node:test'
export { default as assert } from 'node:assert/strict'
