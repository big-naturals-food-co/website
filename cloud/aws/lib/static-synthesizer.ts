import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  StackSynthesizer, type ISynthesisSession, type FileAssetSource,
  type FileAssetLocation, type DockerImageAssetSource, type DockerImageAssetLocation,
} from 'aws-cdk-lib'

/** These stacks contain inline resources only. Website files are uploaded by CI. */
export class StaticSynthesizer extends StackSynthesizer {
  constructor(private readonly executionRoleArn?: string) { super() }

  override get cloudFormationExecutionRole() { return this.executionRoleArn }

  addFileAsset(_asset: FileAssetSource): FileAssetLocation {
    throw new Error('This static site has no CDK file assets. Publish web files through GitHub.')
  }

  addDockerImageAsset(_asset: DockerImageAssetSource): DockerImageAssetLocation {
    throw new Error('This static site has no Docker assets.')
  }

  synthesize(session: ISynthesisSession): void {
    this.synthesizeTemplate(session)
    const template = readFileSync(path.join(session.assembly.outdir, this.boundStack.templateFile))
    if (template.byteLength > 51_200) {
      throw new Error('Template exceeds the CloudFormation inline limit; review asset publishing permissions before expanding it.')
    }
    this.emitArtifact(session, { cloudFormationExecutionRoleArn: this.executionRoleArn })
  }
}
