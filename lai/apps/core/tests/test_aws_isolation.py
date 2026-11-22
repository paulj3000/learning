"""Django tests never see the host's AWS profile, credentials or metadata service (GE-090 P1).

With an SSO profile in the environment, botocore ignored a test's fake keys and tried to refresh
the developer's real SSO token, so `test_presigned_urls_use_the_regional_host` passed or failed by
host. `lai/conftest.py` (`isolated_aws_config`) removes that ambient state for every test.
"""

import os

import boto3


def test_no_ambient_aws_profile_or_credentials_reach_a_test():
    for name in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SESSION_TOKEN"):
        assert name not in os.environ, name
    assert os.environ["AWS_EC2_METADATA_DISABLED"] == "true"
    session = boto3.session.Session()
    assert session.available_profiles == []
    assert session.get_credentials() is None


def test_fake_keys_a_test_sets_are_the_only_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    credentials = boto3.session.Session().get_credentials()
    assert credentials.access_key == "testing"
    assert credentials.method == "env"
