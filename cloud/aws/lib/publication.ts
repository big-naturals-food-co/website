import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ProjectConfig } from './config.js'

export interface PublicationFile {
  key: string
  file: string
  contentType: string
  cacheControl: string
  phase: number
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
}

const pages = [
  { route: '/', key: 'index.html' },
  { route: '/goose-nibbles', key: 'goose-nibbles/index.html' },
]

export function publicationPlan(directory: string): PublicationFile[] {
  const files: PublicationFile[] = []
  function walk(relative: string): void {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
        throw new Error(`Unexpected hidden file or symlink in site output: ${entry.name}`)
      }
      const key = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) { walk(key); continue }
      if (!entry.isFile()) throw new Error(`Unexpected output entry: ${key}`)
      if (!key.startsWith('_nuxt/') && !['index.html', '_payload.json', 'favicon.png', 'favicon.ico', 'goose-nibbles/index.html', 'goose-nibbles/_payload.json'].includes(key)) {
        throw new Error(`Output path is not recognized by the site routing: ${key}`)
      }
      const contentType = contentTypes[path.extname(key)]
      if (!contentType) throw new Error(`Unknown content type: ${key}`)
      const immutable = key.startsWith('_nuxt/') && !key.startsWith('_nuxt/builds/')
      files.push({
        key, file: path.join(directory, key), contentType,
        cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate',
        phase: immutable ? 0 : key === '_nuxt/builds/latest.json' ? 3 : key.endsWith('.html') ? 2 : 1,
      })
    }
  }
  walk('')
  for (const page of pages) {
    if (!files.some(file => file.key === page.key) || !statSync(path.join(directory, page.key)).size) {
      throw new Error(`Refusing to publish without a non-empty ${page.key}.`)
    }
  }
  return files.sort((a, b) => a.phase - b.phase || a.key.localeCompare(b.key))
}

export function deploymentDestination(outputs: unknown, project: ProjectConfig) {
  const stack = (outputs as Record<string, Record<string, unknown>>)?.[project.stackName]
  const bucket = `big-naturals-food-co-site-${project.account}-${project.region}`
  if (!stack || stack.BucketName !== bucket || stack.SiteUrl !== `https://${project.domainName}`) {
    throw new Error('Stack outputs do not match the configured production site and bucket.')
  }
  if (typeof stack.DistributionId !== 'string' || !/^[A-Z0-9]+$/.test(stack.DistributionId)) {
    throw new Error('Stack outputs contain no valid CloudFront distribution ID.')
  }
  return { bucket, distributionId: stack.DistributionId, siteUrl: stack.SiteUrl as string }
}

export function assertPublicationIdentity(identity: { Account?: string; Arn?: string }, project: ProjectConfig): void {
  if (identity.Account !== project.account || !identity.Arn || identity.Arn.endsWith(':root')) {
    throw new Error('Site publication requires non-root credentials in the configured AWS account.')
  }
}

export type AwsCommand = (args: string[]) => string

export function publishFiles(plan: PublicationFile[], destination: ReturnType<typeof deploymentDestination>, aws: AwsCommand): string {
  for (const file of plan) {
    aws(['s3', 'cp', file.file, `s3://${destination.bucket}/${file.key}`,
      '--content-type', file.contentType, '--cache-control', file.cacheControl,
      '--only-show-errors', '--no-progress'])
  }
  const invalidation = JSON.parse(aws(['cloudfront', 'create-invalidation', '--distribution-id', destination.distributionId, '--paths', '/*', '--output', 'json']))
  const id = invalidation.Invalidation?.Id
  if (typeof id !== 'string' || !/^[A-Z0-9]+$/.test(id)) throw new Error('CloudFront returned no valid invalidation ID.')
  aws(['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', destination.distributionId, '--id', id])
  return id
}

export async function verifySite(directory: string, project: ProjectConfig, request: typeof fetch = fetch): Promise<void> {
  const origin = `https://${project.domainName}`
  const assets = new Set(['/favicon.png', '/favicon.ico'])
  for (const page of pages) {
    const expected = readFileSync(path.join(directory, page.key), 'utf8')
    const response = await request(origin + page.route, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status !== 200 || await response.text() !== expected) {
      throw new Error(`The public ${page.route === '/' ? 'homepage' : page.route} does not match this generated build.`)
    }
    for (const match of expected.matchAll(/(?:src|href)="(\/_nuxt\/[^"?#]+)"/g)) assets.add(match[1]!)
    assets.add(page.route === '/' ? '/_payload.json' : `${page.route}/_payload.json`)
  }
  for (const asset of assets) {
    const response = await request(origin + asset, { signal: AbortSignal.timeout(15_000) })
    const expectedBytes = readFileSync(path.join(directory, asset.slice(1)))
    const actual = Buffer.from(await response.arrayBuffer())
    if (response.status !== 200 || !actual.equals(expectedBytes)) throw new Error(`Public asset differs or is missing: ${asset}`)
  }
  for (const url of [`${origin}/__deployment-check`, ...project.redirectDomainNames.map(domain => `https://${domain}/`)]) {
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status !== 302 || response.headers.get('location') !== `${origin}/`) throw new Error(`Unexpected root redirect: ${url}`)
  }
  for (const url of [`${origin}/goose-nibbles/`, `${origin}/goose-nibbles/index.html`, ...project.redirectDomainNames.map(domain => `https://${domain}/goose-nibbles`)]) {
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (response.status !== 302 || response.headers.get('location') !== `${origin}/goose-nibbles`) throw new Error(`Unexpected Goose Nibbles redirect: ${url}`)
  }
}
