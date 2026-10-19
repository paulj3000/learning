"""Locally generated keys and tokens. No AWS call, no real pool or client id."""

import base64
import json
import time

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

REGION = "us-test-1"
POOL_ID = "us-test-1_TESTPOOL1"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}"
CLIENT_ID = "test-client-id-0001"


class KeyPair:
    def __init__(self, kid: str):
        self.kid = kid
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def jwk(self) -> dict:
        numbers = self.private.public_key().public_numbers()

        def b64(value: int) -> str:
            raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
            return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

        return {
            "kty": "RSA",
            "kid": self.kid,
            "use": "sig",
            "alg": "RS256",
            "n": b64(numbers.n),
            "e": b64(numbers.e),
        }

    def sign(self, claims: dict, *, kid="__default__", algorithm="RS256", headers=None) -> str:
        header = {"kid": self.kid if kid == "__default__" else kid, **(headers or {})}
        header = {k: v for k, v in header.items() if v is not None}
        return jwt.encode(claims, self.private, algorithm=algorithm, headers=header)


def jwks_body(*pairs: KeyPair) -> bytes:
    return json.dumps({"keys": [pair.jwk() for pair in pairs]}).encode()


def access_claims(sub="sub-parent-a", **overrides) -> dict:
    now = int(time.time())
    claims = {
        "sub": sub,
        "iss": ISSUER,
        "client_id": CLIENT_ID,
        "token_use": "access",
        "scope": "aws.cognito.signin.user.admin",
        "auth_time": now - 60,
        "iat": now - 60,
        "exp": now + 3600,
        "jti": "jti-1",
        "username": sub,
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}
