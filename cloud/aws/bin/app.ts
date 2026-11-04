import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { parseProjectConfig } from '../lib/config.js'
import { SignupStack } from '../lib/signup-stack.js'
import { parseSignupConfig, signupNames } from '../lib/signup-config.js'
import { SiteStack } from '../lib/site-stack.js'

const app = new App()
const directory = fileURLToPath(new URL('../', import.meta.url))
const configPath = path.resolve(directory, app.node.tryGetContext('projectConfig') ?? 'project.json')
let contents: string
try {
  contents = readFileSync(configPath, 'utf8')
} catch {
  throw new Error(`Cannot read ${configPath}. Configure project.json or run npm run synth:example for offline validation.`)
}
const project = parseProjectConfig(JSON.parse(contents))
new SiteStack(app, project.stackName, { project })

const signup = parseSignupConfig(JSON.parse(readFileSync(path.resolve(directory, '../signup.json'), 'utf8')))
new SignupStack(app, signupNames.stack, { project, signup })
