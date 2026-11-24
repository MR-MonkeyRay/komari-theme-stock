// Release guard: komari-theme.json and package.json agree on the version, the manifest has what
// Komari needs, and on a tag build the tag is v<version>. Writes `version` and `zip` to
// $GITHUB_OUTPUT when run in GitHub Actions.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file) => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
const manifest = read('komari-theme.json')
const pkg = read('package.json')
const errors = []

for (const key of ['name', 'short', 'version', 'author']) {
  if (!manifest[key]) errors.push(`komari-theme.json is missing "${key}"`)
}
if (manifest.version !== pkg.version) {
  errors.push(`version mismatch: komari-theme.json ${manifest.version}, package.json ${pkg.version}`)
}
if (manifest.preview && !existsSync(resolve(root, manifest.preview))) {
  errors.push(`preview "${manifest.preview}" listed in komari-theme.json does not exist`)
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${manifest.version}`) {
  errors.push(`tag ${process.env.GITHUB_REF_NAME} does not match version v${manifest.version}`)
}

if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`)
  process.exit(1)
}

const zip = `release/${manifest.short}-${manifest.version}.zip`
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${manifest.version}\nzip=${zip}\n`)
console.log(`${manifest.short} ${manifest.version} -> ${zip}`)
