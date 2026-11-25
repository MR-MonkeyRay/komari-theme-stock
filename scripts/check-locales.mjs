// Checks every language file against the source (zh-CN): the same keys, the plural forms each
// language uses, and the same {{placeholders}} and <tags>. Runs before the build.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '../src/i18n/locales')
const SOURCE = 'zh-CN'
const PLURAL = /_(zero|one|two|few|many|other)$/
/** Keys that may be empty in a language (a unit some languages leave out). */
const MAY_BE_EMPTY = new Set(['index.hotUnit'])

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, key, out)
    else out.set(key, v)
  }
  return out
}

/** key -> { forms: Map<category, text> } for plurals, or { text } otherwise. */
function entries(flat) {
  const out = new Map()
  for (const [key, text] of flat) {
    const m = key.match(PLURAL)
    if (m) {
      const base = key.slice(0, -m[0].length)
      const e = out.get(base) ?? { forms: new Map() }
      e.forms.set(m[1], text)
      out.set(base, e)
    } else out.set(key, { text })
  }
  return out
}

const tokens = (s) => new Set([...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}|<\/?(\w+)>/g)].map((m) => m[0].replace(/\s/g, '')))
const textsOf = (e) => (e.forms ? [...e.forms.values()] : [e.text])

/** Plural categories integers actually reach in a language ('other' always, as the default). */
function pluralNeeds(lang) {
  const rules = new Intl.PluralRules(lang)
  const used = new Set(['other'])
  for (let n = 0; n <= 200; n++) used.add(rules.select(n))
  return { used, allowed: new Set(rules.resolvedOptions().pluralCategories) }
}

const load = (lang) => entries(flatten(JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8'))))
const source = load(SOURCE)
const errors = []

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const lang = file.slice(0, -5)
  const target = load(lang)
  const { used, allowed } = pluralNeeds(lang)
  const err = (key, msg) => errors.push(`${lang}: ${key}: ${msg}`)

  for (const [key, src] of source) {
    const e = target.get(key)
    if (!e) {
      err(key, 'missing')
      continue
    }
    if (!!src.forms !== !!e.forms) {
      err(key, src.forms ? 'must be plural (key_one, key_other, …)' : 'must not be plural')
      continue
    }
    if (e.forms) {
      for (const c of used) if (!e.forms.has(c)) err(key, `missing plural form _${c}`)
      for (const c of e.forms.keys()) if (!allowed.has(c)) err(key, `plural form _${c} is not used in ${lang}`)
    }
    // Every placeholder and tag of the source appears in the text ({{count}} may be spelled out in a singular form).
    const want = new Set(textsOf(src).flatMap((t) => [...tokens(t)]))
    for (const [form, text] of e.forms ?? [['', e.text]]) {
      if (typeof text !== 'string' || (!text.trim() && !MAY_BE_EMPTY.has(key))) err(key, 'empty')
      const got = tokens(text)
      for (const t of got) if (!want.has(t)) err(key + (form && `_${form}`), `unknown ${t}`)
      for (const t of want) if (!got.has(t) && !(t === '{{count}}' && form !== 'other')) err(key + (form && `_${form}`), `missing ${t}`)
    }
  }
  for (const key of target.keys()) if (!source.has(key)) err(key, 'not in the source (zh-CN)')
}

if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\n${errors.length} problem(s) in src/i18n/locales`)
  process.exit(1)
}
console.log('i18n: every language matches the source')
