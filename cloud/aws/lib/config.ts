export interface ProjectConfig {
  account: string
  region: 'us-east-1'
  domainName: string
  redirectDomainNames: string[]
  zoneName: string
  hostedZoneId: string
  stackName: string
}

export function parseProjectConfig(input: unknown): ProjectConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Project configuration must be a JSON object.')
  }
  const config = input as Record<string, unknown>
  const string = (name: string, pattern: RegExp): string => {
    const value = config[name]
    if (typeof value !== 'string' || !pattern.test(value)) {
      throw new Error(`Invalid or missing ${name} in project configuration.`)
    }
    return value
  }
  const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
  const account = string('account', /^\d{12}$/)
  const domainName = string('domainName', domainPattern)
  const zoneName = string('zoneName', domainPattern)
  const hostedZoneId = string('hostedZoneId', /^Z[A-Z0-9]+$/)
  const stackName = string('stackName', /^[A-Za-z][A-Za-z0-9-]{0,127}$/)
  if (config.region !== 'us-east-1') {
    throw new Error('Use us-east-1 for this stack and its CloudFront certificate.')
  }
  const aliases = config.redirectDomainNames
  if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string' || !domainPattern.test(alias))) {
    throw new Error('redirectDomainNames must be an array of lowercase domain names.')
  }
  const domains = [domainName, ...aliases as string[]]
  if (new Set(domains).size !== domains.length) {
    throw new Error('Canonical and redirect domains must be unique.')
  }
  if (domains.some((domain) => domain !== zoneName && !domain.endsWith(`.${zoneName}`))) {
    throw new Error('All domains must belong to the configured hosted zone.')
  }
  return {
    account, region: 'us-east-1', domainName,
    redirectDomainNames: aliases as string[], zoneName, hostedZoneId, stackName,
  }
}
