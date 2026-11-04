import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseProjectConfig } from '../lib/config.js'
import { assertPublicationIdentity, deploymentDestination, publicationPlan, publishFiles } from '../lib/publication.js'

const { values } = parseArgs({ options: { outputs: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } } })
const project = parseProjectConfig(JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8')))
const directory = fileURLToPath(new URL('../../../web/.output/public/', import.meta.url))
const plan = publicationPlan(directory)
if (values['dry-run']) {
  console.log(JSON.stringify(plan.map(({ key, cacheControl, phase }) => ({ key, cacheControl, phase })), null, 2))
} else {
  if (!values.outputs) throw new Error('Provide --outputs with the CDK deployment outputs file, or use --dry-run.')
  const destination = deploymentDestination(JSON.parse(readFileSync(values.outputs, 'utf8')), project)
  const aws = (args: string[]) => execFileSync('aws', [...args, '--region', project.region], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  assertPublicationIdentity(JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json'])), project)
  const invalidationId = publishFiles(plan, destination, aws)
  console.log(`Published ${plan.length} files to ${destination.siteUrl}; invalidation ${invalidationId} completed.`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Published ${plan.length} files to ${destination.siteUrl}\n\nCloudFront invalidation: ${invalidationId}\n`)
}
