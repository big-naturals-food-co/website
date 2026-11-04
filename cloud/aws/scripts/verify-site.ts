import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseProjectConfig } from '../lib/config.js'
import { verifySite } from '../lib/publication.js'

const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8')))
const directory = fileURLToPath(new URL('../../../web/.output/public/', import.meta.url))
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    await verifySite(directory, project)
    console.log(`Verified https://${project.domainName}: exact build, assets, and root redirects.`)
    break
  } catch (error) {
    if (attempt === 12) throw error
    console.log(`Verification ${attempt}/12: ${error instanceof Error ? error.message : String(error)}. Retrying in 10 seconds.`)
    await setTimeout(10_000)
  }
}
