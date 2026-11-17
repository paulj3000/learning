"""The Django-free core of background processing (shared by Django and the Lambda worker).

Everything in this package is plain Python: no Django, no `apps.*` import, no boto3, and only
relative imports among its own modules. `scripts/aws/package-lambda.sh` copies it into the worker
zip unchanged, and Django's inline backend runs the very same task code in-process, so the two
paths cannot drift. AWS and Django specifics reach a task only through a `ports` object.
"""
