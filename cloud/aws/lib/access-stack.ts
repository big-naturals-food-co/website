import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { parseProjectConfig, type ProjectConfig } from './config.js'
import { accessNames, deploymentStatements, executionStatements, signupRuntimeStatements } from './access.js'
import { signupNames } from './signup-config.js'
import { StaticSynthesizer } from './static-synthesizer.js'

export class AccessStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { project: ProjectConfig }) {
    const project = parseProjectConfig(props.project)
    super(scope, id, {
      ...props, env: { account: project.account, region: project.region },
      synthesizer: new StaticSynthesizer(), terminationProtection: true,
    })
    Tags.of(this).add('Project', accessNames.projectTag)

    const operator = new iam.User(this, 'Operator', { userName: accessNames.operator })
    // Password/MFA are configured privately in IAM after template creation.
    operator.applyRemovalPolicy(RemovalPolicy.RETAIN)
    operator.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SignInLocalDevelopmentAccess'))
    operator.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:GetUser', 'iam:ChangePassword', 'iam:ListMFADevices'], resources: [operator.userArn],
    }))
    operator.addToPolicy(new iam.PolicyStatement({ actions: ['iam:GetAccountPasswordPolicy'], resources: ['*'] }))

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'ExistingGitHubProvider',
      `arn:aws:iam::${project.account}:oidc-provider/token.actions.githubusercontent.com`)
    const github = new iam.Role(this, 'GitHubDeploy', {
      roleName: accessNames.githubRole,
      description: 'Big Naturals site deployment from the website repository main branch.',
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': accessNames.githubSubject,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    })
    const deployPolicy = new iam.ManagedPolicy(this, 'SiteDeployment', {
      managedPolicyName: 'big-naturals-food-co-site-deployment',
      statements: deploymentStatements(project),
    })
    operator.addManagedPolicy(deployPolicy)
    github.addManagedPolicy(deployPolicy)
    github.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:PutParameter'],
      resources: [signupNames.brevoParameter, signupNames.turnstileParameter].map(name => `arn:aws:ssm:${project.region}:${project.account}:parameter${name}`),
    }))

    const execution = new iam.Role(this, 'CloudFormationExecution', {
      roleName: accessNames.executionRole,
      description: 'Service role for Big Naturals site and signup stacks; no IAM management.',
      assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
    })
    // Inline role policies avoid the managed policy 6,144-character limit.
    new iam.Policy(this, 'SiteExecution', { roles: [execution], statements: executionStatements(project) })

    const signupRuntime = new iam.Role(this, 'SignupRuntime', {
      roleName: signupNames.role,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    })
    new iam.Policy(this, 'SignupRuntimePolicy', { roles: [signupRuntime], statements: signupRuntimeStatements(project) })

    new CfnOutput(this, 'OperatorUserName', { value: operator.userName })
    new CfnOutput(this, 'ConsoleSignInUrl', { value: `https://${project.account}.signin.aws.amazon.com/console/` })
    new CfnOutput(this, 'GitHubDeployRoleArn', { value: github.roleArn })
    new CfnOutput(this, 'CloudFormationExecutionRoleArn', { value: execution.roleArn })
  }
}
