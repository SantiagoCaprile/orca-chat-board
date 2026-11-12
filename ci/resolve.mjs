export async function resolve(specifier, context, next) {
  if (specifier === 'orca/testing') return { url: new URL('./orca-testing.mjs', import.meta.url).href, shortCircuit: true }
  return next(specifier, context)
}
