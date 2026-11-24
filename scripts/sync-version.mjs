// Runs as the npm "version" lifecycle script: copies the new package.json version into
// komari-theme.json so `npm version <x.y.z>` bumps both and tags v<x.y.z>.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const file = resolve(root, 'komari-theme.json')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(file, 'utf8'))
manifest.version = version
writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
console.log(`komari-theme.json -> ${version}`)
