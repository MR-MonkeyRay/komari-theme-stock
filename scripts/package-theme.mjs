// Packs the theme into release/<short>-<version>.zip with komari-theme.json at the zip root.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ZipArchive } from 'archiver'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'komari-theme.json'), 'utf8'))
if (!existsSync(resolve(root, 'dist/index.html'))) {
  console.error('dist/index.html not found, run `npm run build` first')
  process.exit(1)
}

mkdirSync(resolve(root, 'release'), { recursive: true })
const target = resolve(root, 'release', `${manifest.short}-${manifest.version}.zip`)
const output = createWriteStream(target)
const zip = new ZipArchive({ zlib: { level: 9 } })

output.on('close', () => console.log(`packed ${target} (${zip.pointer()} bytes)`))
zip.on('warning', (err) => console.warn(err))
zip.on('error', (err) => {
  throw err
})
zip.pipe(output)
zip.file(resolve(root, 'komari-theme.json'), { name: 'komari-theme.json' })
if (manifest.preview && existsSync(resolve(root, manifest.preview))) {
  zip.file(resolve(root, manifest.preview), { name: manifest.preview })
}
zip.directory(resolve(root, 'dist'), 'dist')
await zip.finalize()
