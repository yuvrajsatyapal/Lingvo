// Every number and claim shown on screen is read from the project README here.
// If the README wording changes and a fact can't be found, the build fails loudly.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const readme = readFileSync(join(here, '../../README.md'), 'utf8')

function grab(re: RegExp, label: string): string[] {
  const m = readme.match(re)
  if (!m) throw new Error(`README fact not found: ${label} (${re})`)
  return m.slice(1)
}

const [conditions] = grab(/\|\s*Measure\s*\|\s*Result \(([^)]+)\)\s*\|/, 'performance conditions')
const [endToLine] = grab(/\|\s*End of speech to finished line\s*\|\s*~([\d.]+)\s*s/, 'end of speech to finished line')
const [recognition] = grab(/\|\s*Speech recognition pass\s*\|\s*~([\d.]+)\s*s/, 'recognition pass')
const [translation] = grab(/\|\s*Translation of one sentence\s*\|\s*~([\d.]+[–-][\d.]+)\s*s/, 'translation of one sentence')
const [promise] = grab(/(No accounts, no cloud, no cost)\./, 'no accounts line')
const [neverUploaded] = grab(/(Audio is never uploaded and never saved)\./, 'privacy line')

const facts = {
  conditions: conditions.replace(' to ', ' → '),
  endToLine,
  recognition,
  translation,
  promise: promise.split(',').map((s) => s.trim().replace(/^./, (c) => c.toUpperCase())),
  neverUploaded,
}

writeFileSync(join(here, '../src/facts.generated.json'), JSON.stringify(facts, null, 2) + '\n')
console.log('facts:', facts)
