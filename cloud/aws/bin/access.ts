import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { App } from 'aws-cdk-lib'
import { AccessStack } from '../lib/access-stack.js'
import { accessNames } from '../lib/access.js'
import { parseProjectConfig } from '../lib/config.js'

const app = new App()
const directory = fileURLToPath(new URL('../', import.meta.url))
const configPath = path.resolve(directory, app.node.tryGetContext('projectConfig') ?? 'project.json')
const project = parseProjectConfig(JSON.parse(readFileSync(configPath, 'utf8')))
new AccessStack(app, accessNames.stack, { project })
