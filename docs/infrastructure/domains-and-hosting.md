# Target domains, hosting and security (LAI-INFRA-003)

Date: 2026-11-09. Trello: [LAI-INFRA-003](https://trello.com/c/gdwR5KXG). Base: `main` at
`a268ac5` (LAI-INFRA-002 merged). Inputs: `docs/infrastructure/inventory.md`,
`docs/infrastructure/resource-ownership.md`.

**Status: proposed changeset, not deployed.** It changes CDK, nginx and the release scripts, and
it is tested by synthesis and by local nginx runs. No AWS resource or DNS record was created or
changed. Every deployment step in section 7 needs owner approval.

## 1. Decisions

| # | Decision | Source |
|---|---|---|
| H1 | **Same-origin API.** `lai.<domain>` CloudFront sends `/api/*` to the Django load balancer. The React app keeps calling `/api/` with `VITE_DJANGO_API_BASE` empty. Django gets **no CORS** (TR-D14 stands). | Owner, 2026-11-09, on this card |
| H2 | `api.<domain>` and `ladm.<domain>` share the existing ALB and EC2/nginx in us-west-1, with **one** certificate for both names | Card; INFRA-002 (ALB owned by `LaiDjangoEc2-<env>`) |
| H3 | The React site is a new stack, `LaiFrontend-<env>`, **deployed in us-east-1**. CloudFront only takes us-east-1 certificates, so the whole stack lives there. | INFRA-002 D2 (recommended) |
| H4 | Route 53 zone stays outside IaC; stacks add alias records only when `LAI_HOSTED_ZONE_ID`/`NAME` are given | INFRA-002 D6 (recommended) |

With H1, `api.<domain>` is still a public HTTPS name, for two reasons:
- it is CloudFront's origin for `/api/*`;
- the release workflow's smoke test (`LAI_API_BASE_URL`) uses it.

No browser page on another origin calls it, so CORS is never needed. The Android app uses
`lai.<domain>` too, not `api.`: its WebView game page (`/game/`) and the API must share one origin
for the `lai_game_session` cookie (`docs/android/ANDROID_GAME_LAUNCH.md`). CloudFront gives it
that: `/game/` comes from S3, and `/api/*` with its cookies goes to Django.

## 2. Domain map

| Host | Serves | Path rules | TLS | Origin |
|---|---|---|---|---|
| `lai.pauldimitriu.com` | React build and, once built, the Android game runtime (`/game/`) | `/api/*` to `api.` (not cached); everything else from S3. Extensionless paths are rewritten to `/index.html` (`/game/...` to `/game/index.html`); a missing `.js`/`.css` stays an error | ACM in **us-east-1** (`LaiFrontend-<env>`), TLS 1.2+ | Private S3 bucket `lai-web-<env>-<account>-us-east-1` through OAC; `api.` over HTTPS |
| `api.pauldimitriu.com` | Django REST API | `/api/` only. The admin, `/static/` and `/` return 404 (nginx) | ACM in **us-west-1** (`LaiDjangoEc2-<env>`), name 1 of 2 | ALB, then nginx :8080, then gunicorn |
| `ladm.pauldimitriu.com` | Django Admin | `/` redirects to `/admin/`. The admin and `/static/` are served; `/api/` returns 404 (nginx) | Same certificate, name 2 of 2 | Same ALB and instance |
| Any other `Host` on the ALB | nothing | The ALB answers 404 itself; nginx's default server answers only health probes | n/a | n/a |

The domain names are the card's. The stacks take them as parameters (`ApiDomainName`,
`AdminDomainName`, `SiteDomainName`), so dev and prod can use other names (for example
`dev-api.`). The card does not say which environment gets the bare names; that is an owner
choice for 7.1.

## 3. DNS records and certificate validation

Whether `pauldimitriu.com` is a Route 53 zone in this account is unknown (inventory U10).

**With Route 53** (`LAI_HOSTED_ZONE_ID`, `LAI_HOSTED_ZONE_NAME`), the stacks validate both
certificates and create:

| Record | Type | Target | Stack |
|---|---|---|---|
| `api.<domain>` | A (alias) | ALB | `LaiDjangoEc2-<env>` |
| `ladm.<domain>` | A (alias) | ALB | `LaiDjangoEc2-<env>` |
| `lai.<domain>` | A and AAAA (alias) | CloudFront distribution | `LaiFrontend-<env>` |

**Without Route 53**, create these at the DNS provider:

| Record | Type | Value | When |
|---|---|---|---|
| ACM validation for `api.<domain>` | CNAME | Shown in ACM, **us-west-1** | While `LaiDjangoEc2` waits on its certificate |
| ACM validation for `ladm.<domain>` | CNAME | Shown in ACM, us-west-1 (same certificate, second name) | Same time |
| ACM validation for `lai.<domain>` | CNAME | Shown in ACM, **us-east-1** | While `LaiFrontend` waits |
| `api.<domain>` | CNAME | Output `LoadBalancerDnsName` | After `LaiDjangoEc2` completes |
| `ladm.<domain>` | CNAME | Output `LoadBalancerDnsName` | Same |
| `lai.<domain>` | CNAME | Output `DistributionDomainName` (`dxxxx.cloudfront.net`) | After `LaiFrontend` completes; this is the cutover step (7.4) |

Keep the validation CNAMEs: ACM renews through them.

## 4. Security checklist

| Card item | How it is met | Where |
|---|---|---|
| Cognito preserved | Unchanged. The Amplify `main` pool stays the owner (INFRA-002 D5), and Django validates its tokens. `defineAuth` uses email sign-in with no hosted UI, so no callback URLs need the new host | `amplify/auth/resource.ts`; `CognitoUserPoolId` parameter |
| Private child assets | The child photo bucket is never behind CloudFront (ADR-042). CloudFront fronts only the web bucket and `/api/*`. Asset files are signed `/api/v1/asset-files/...` URLs, or S3 presigned URLs. API responses are never cached at the edge (`CachingDisabled`) | `frontendStack.ts`; `childPhotoStorageStack.ts` |
| DB private | RDS sits in isolated subnets with no NAT. Its security group admits 5432 only from the instance, and it is not publicly accessible. `rds.force_ssl=1`; storage is encrypted | `djangoEc2Stack.ts` (unchanged) |
| Secrets secured | The DB password is in Secrets Manager. `DJANGO_SECRET_KEY` and AI settings are operator-written SSM values. No secret is in a template, the React build or CloudFront | Unchanged |
| Django trusted hosts | `DJANGO_ALLOWED_HOSTS` = API and admin hosts only, and production refuses `*`. The ALB forwards only those two hosts | SSM from the stack; listener rule |
| CORS | None (H1). No CORS package, and the browser only ever calls its own origin | `lai/config/settings/base.py` |
| CSRF | `DJANGO_CSRF_TRUSTED_ORIGINS` = `https://<admin host>` only. The API is bearer-only and CSRF-exempt. Admin cookies are scoped to `/admin/`, HttpOnly, Secure, SameSite=Lax, with no `Domain` attribute, so they never reach `api.` or `lai.` | SSM from the stack; settings |
| Host-based admin isolation | Three layers: the ALB forwards only known hosts; nginx gives each host only its own paths (tested); WAF rate-limits `POST /admin/login` | `djangoEc2Stack.ts`; `default.conf.template`; `tests/deploy/test_nginx_hosts.py` |
| HTTPS everywhere | HTTP redirects to HTTPS at the ALB and CloudFront. TLS 1.2+ on both. HSTS: one year with `includeSubDomains` from CloudFront and Django | Both stacks |
| Privacy (G10) | No CloudFront or nginx access logs; request paths carry child ids | Both stacks |

## 5. The changeset

| File | Change |
|---|---|
| `infra/lib/djangoEc2Stack.ts` | New `AdminDomainName` parameter, used as the certificate's second name. The listener's default action becomes a fixed 404, with a rule forwarding only the API and admin hosts. SSM `DJANGO_ALLOWED_HOSTS` gets both hosts and `DJANGO_CSRF_TRUSTED_ORIGINS` the admin host. `LAI_ADMIN_HOST` is passed to the instance. Adds an `AdminAlias` record (with a zone) and an `AdminBaseUrl` output |
| `infra/lib/frontendStack.ts` (new) | `LaiFrontend-<env>`: private versioned bucket with OAC, a us-east-1 certificate, the distribution with the `/api/*` behaviour and the SPA rewrite function, Amplify's security headers, and optional A/AAAA aliases. No Lambda, role or asset |
| `infra/bin/app.ts` | Registers `LaiFrontend-<env>` in us-east-1 |
| `deploy/ec2/nginx/default.conf.template` | One server per host plus a health-only default server. Relative redirects (`absolute_redirect off`): without it nginx would redirect to `http://<host>:8080/...` |
| `deploy/ec2/docker-compose.yml`, `scripts/aws/{setup-ec2,lib,status}.sh` | `LAI_ADMIN_HOST` from the stack to `deploy.conf`, `release.env` and the nginx container (required, like `LAI_API_HOST`) |
| `scripts/aws/provision.sh` | `LAI_ADMIN_DOMAIN` (required). `LAI_SITE_DOMAIN` (optional) deploys `LaiFrontend-<env>` in us-east-1 |
| Tests | `infra/lib/frontendStack.test.ts` (new, 8 tests), `infra/lib/djangoDeployment.test.ts` (host rule, CSRF, aliases), `tests/deploy/test_nginx_hosts.py` (new: real nginx, three host cases; skipped without nginx) |
| Docs | This file, `docs/platform/DJANGO_EC2_DEPLOYMENT.md`, `infra/README.md` |

Nothing is deployed today (inventory section 4.1), so every change above lands as a create. If
`LaiDjangoEc2-<env>` had been deployed with an API-only certificate, adding the admin name would
**replace** that certificate (new ARN, new validation). The listener would then switch over
without downtime, once the new certificate validates.

## 6. Not covered here

- **The release pipeline for the site** (upload, `Cache-Control`, invalidation, and the build's
  `amplify_outputs.json` from the `main` backend) is designed and built, switched off, in
  LAI-INFRA-004: `docs/infrastructure/deployment-design.md`.
- **CloudFront WAF.** Optional: a `CLOUDFRONT`-scope Web ACL must live in us-east-1. The admin is
  not behind CloudFront, and the ALB rate rule covers the admin login.
- **Locking the ALB to CloudFront.** Not possible while `api.` is also called directly (the
  release workflow's smoke test). Revisit if that moves behind `lai.`.
- **A non-default `DJANGO_ADMIN_URL_PATH`.** The admin host's `/` redirect assumes `/admin/`.
  Nothing sets another path today.
- **Django-level host isolation** (refusing admin URLs on the API host in Django itself). nginx and
  the ALB already enforce it. It could be added later as a fourth layer.

## 7. Rollout (each step needs owner approval)

1. Choose the names per environment (bare names for prod or for dev). Confirm whether
   `pauldimitriu.com` is in Route 53 (U10). Run the INFRA-002 checks: OIDC provider (D4), and no
   conflicting stack from `lai-dev-complete.yaml` (D1).
2. `scripts/aws/provision.sh dev` with `LAI_API_DOMAIN`, `LAI_ADMIN_DOMAIN` and, when ready,
   `LAI_SITE_DOMAIN`. This creates change sets only; review them, then run with `--execute`.
   Add the validation CNAMEs from section 3 while the stacks wait.
3. Smoke test the API and admin hosts:
   - `curl -fsS https://api.<domain>/api/v1/health/ready/` returns 200.
   - `curl -s -o /dev/null -w '%{http_code}' https://api.<domain>/admin/` returns 404.
   - `https://ladm.<domain>/` redirects to `/admin/`.
   - `https://ladm.<domain>/api/v1/health/` returns 404.
   - `https://<ALB DNS name>/` returns 404.
4. **Cutover.** Upload a build (`VITE_BACKEND=django`, empty `VITE_DJANGO_API_BASE`) to the
   web bucket, then add the `lai.` record. Amplify Hosting keeps serving its own domain the whole
   time, so nothing switches by accident. Test sign-in, play, `/api/` calls and 3D asset loading
   on desktop and mobile.
5. Retiring Amplify Hosting's frontend is a separate, later approval (INFRA-004 decides the
   pipeline).
