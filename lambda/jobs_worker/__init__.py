"""LAI background jobs worker (AWS Lambda, Python 3.12, arm64). Entry point: `handler.handle`.

The task code and the Bedrock adapter are vendored from the Django project at package time
(`scripts/aws/package-lambda.sh`): `vendor/jobs_core` is `lai/apps/jobs/core` and
`vendor/ai_providers` holds `lai/apps/ai/providers/{base,bedrock}.py`. Only the Lambda runtime's
boto3 is used; there are no third-party dependencies.
"""
