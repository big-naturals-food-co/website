import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { ARecord, AaaaRecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets'
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'
import { parseProjectConfig, type ProjectConfig } from './config.js'
import { landingRequestCode } from './landing-request.js'
import { executionRoleArn } from './access.js'
import { StaticSynthesizer } from './static-synthesizer.js'

export interface SiteStackProps extends StackProps {
  project: ProjectConfig
}

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    const project = parseProjectConfig(props.project)
    super(scope, id, {
      ...props,
      env: { account: project.account, region: project.region },
      synthesizer: new StaticSynthesizer(executionRoleArn(project)),
      terminationProtection: true,
    })
    Tags.of(this).add('Project', 'BigNaturalsFoodCo')
    Tags.of(this).add('Environment', 'production')

    // Import by ID to keep synthesis offline and avoid context lookups.
    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: project.hostedZoneId,
      zoneName: project.zoneName,
    })
    const domains = [project.domainName, ...project.redirectDomainNames]
    const certificate = new Certificate(this, 'Certificate', {
      domainName: project.domainName,
      subjectAlternativeNames: project.redirectDomainNames,
      validation: CertificateValidation.fromDns(zone),
    })
    const bucket = new Bucket(this, 'Site', {
      bucketName: `big-naturals-food-co-site-${project.account}-${project.region}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })
    const routes = new cloudfront.Function(this, 'LandingRoutes', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(landingRequestCode(project.domainName)),
      comment: 'Redirect non-asset paths and alternate hosts to the landing page.',
    })
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      },
    })
    const cache = new cloudfront.CachePolicy(this, 'Cache', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.minutes(5),
      maxTtl: Duration.days(365),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
    })
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Big Naturals Food Co. production landing page',
      domainNames: domains,
      certificate,
      defaultRootObject: 'index.html',
      enableIpv6: true,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cache,
        responseHeadersPolicy: headers,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: routes,
        }],
      },
    })

    domains.forEach((domain, index) => {
      const record = { zone, recordName: domain, target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)) }
      new ARecord(this, `Domain${index}A`, record)
      new AaaaRecord(this, `Domain${index}Aaaa`, record)
    })
    new CfnOutput(this, 'SiteUrl', { value: `https://${project.domainName}` })
    new CfnOutput(this, 'BucketName', { value: bucket.bucketName })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'DistributionArn', { value: distribution.distributionArn })
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName })
    new CfnOutput(this, 'CertificateArn', { value: certificate.certificateArn })
  }
}
