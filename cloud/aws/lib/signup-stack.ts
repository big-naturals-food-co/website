import { readFileSync } from 'node:fs'
import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as api from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import { Role } from 'aws-cdk-lib/aws-iam'
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { ApiGatewayv2DomainProperties } from 'aws-cdk-lib/aws-route53-targets'
import type { Construct } from 'constructs'
import { executionRoleArn } from './access.js'
import { parseProjectConfig, type ProjectConfig } from './config.js'
import { parseSignupConfig, signupNames, type SignupConfig } from './signup-config.js'
import { StaticSynthesizer } from './static-synthesizer.js'

export class SignupStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { project: ProjectConfig; signup: SignupConfig }) {
    const project = parseProjectConfig(props.project)
    const signup = parseSignupConfig(props.signup)
    super(scope, id, {
      ...props, env: { account: project.account, region: project.region },
      synthesizer: new StaticSynthesizer(executionRoleArn(project)), terminationProtection: true,
    })
    Tags.of(this).add('Project', 'BigNaturalsFoodCo')
    Tags.of(this).add('Environment', 'production')
    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', { zoneName: project.zoneName, hostedZoneId: project.hostedZoneId })
    const hostname = `api.${project.domainName}`
    const certificate = new Certificate(this, 'Certificate', { domainName: hostname, validation: CertificateValidation.fromDns(zone) })
    const domain = new api.DomainName(this, 'Domain', { domainName: hostname, certificate })
    const logs = new LogGroup(this, 'Logs', {
      logGroupName: signupNames.logs, retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN,
    })
    const fn = new Function(this, 'Subscribe', {
      functionName: signupNames.function,
      code: Code.fromInline(readFileSync(new URL('../lambda/signup.cjs', import.meta.url), 'utf8')),
      handler: 'index.handler', runtime: Runtime.NODEJS_24_X, architecture: Architecture.ARM_64,
      timeout: Duration.seconds(15), memorySize: 256, logGroup: logs,
      role: Role.fromRoleArn(this, 'RuntimeRole', `arn:aws:iam::${project.account}:role/${signupNames.role}`, { mutable: false }),
      environment: {
        SIGNUP_ENABLED: String(signup.enabled), ALLOWED_ORIGIN: `https://${project.domainName}`,
        BREVO_LIST_ID: String(signup.brevoListId ?? 0),
        BREVO_PARAMETER: signupNames.brevoParameter, TURNSTILE_PARAMETER: signupNames.turnstileParameter,
      },
    })
    const gateway = new api.HttpApi(this, 'Api', {
      apiName: 'big-naturals-food-co-signup', disableExecuteApiEndpoint: true, createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [`https://${project.domainName}`], allowHeaders: ['content-type'],
        allowMethods: [api.CorsHttpMethod.POST, api.CorsHttpMethod.OPTIONS], maxAge: Duration.minutes(5),
      },
    })
    gateway.addRoutes({ path: '/subscribe', methods: [api.HttpMethod.POST], integration: new HttpLambdaIntegration('Subscribe', fn) })
    const stage = new api.HttpStage(this, 'Stage', { httpApi: gateway, stageName: '$default', autoDeploy: true, throttle: { rateLimit: 2, burstLimit: 5 } })
    new api.ApiMapping(this, 'Mapping', { api: gateway, domainName: domain, stage })
    new ARecord(this, 'Dns', { zone, recordName: hostname, target: RecordTarget.fromAlias(new ApiGatewayv2DomainProperties(domain.regionalDomainName, domain.regionalHostedZoneId)) })
    new CfnOutput(this, 'SignupEndpoint', { value: `https://${hostname}/subscribe` })
    new CfnOutput(this, 'SignupFunctionName', { value: fn.functionName })
  }
}
