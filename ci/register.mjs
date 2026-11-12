// Resolves `orca/testing` to the CI stand-in, so the pure tests run on plain Node (no Orca).
import { register } from 'node:module'
register('./resolve.mjs', import.meta.url)
