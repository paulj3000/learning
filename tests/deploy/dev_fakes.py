"""Fake `aws`, `gh`, `npm` and `curl` for the native DEV script tests (tests/deploy/test_dev_*.py).

Each fake is this file run as a script with its command name as argv[1]. All behaviour comes from
one JSON document, $FAKE_STATE/state.json, which the fakes also update (put-parameter writes a
parameter, start-execution moves EC2 and RDS to the target state, and so on). Every call is
appended to $FAKE_STATE/calls.log as a JSON list, so tests assert on what the scripts did.
Nothing here touches AWS, GitHub or the network.

`DevEnv` copies the scripts under test into a temporary repository root (so their DEV_REPO_ROOT
is that root), puts the fakes first on PATH and runs a script with a clean LAI_* environment.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FAKE = Path(__file__).resolve()
SCRIPTS = [
    "lib-dev.sh",
    "manage-dev.sh",
    "show-endpoints.sh",
    "dev-release.sh",
    "deploy-debug.sh",
    "install-debug.sh",
]

ACCOUNT = "123456789012"
INSTANCE = "i-0123456789abcdef0"
SM_ARN = f"arn:aws:states:us-west-1:{ACCOUNT}:stateMachine:lai-dev-power"
ARTIFACTS = f"lai-dev-artifacts-{ACCOUNT}-us-west-1"
SITE = "https://lai.example.test"
API = "https://api.example.test"
ADMIN = "https://ladm.example.test/admin/"
CLOUDFRONT = "https://d111111abcdef8.cloudfront.net"
POOL = "us-west-1_AbCdEf123"
CLIENT = "abc123client"

PLATFORM_OUTPUTS = {
    "Environment": "dev",
    "AWSRegion": "us-west-1",
    "InstanceId": INSTANCE,
    "InstanceType": "t4g.small",
    "ElasticIPAddress": "198.51.100.7",
    "DatabaseIdentifier": "lai-dev",
    "DatabaseEndpoint": "lai-dev.abc.us-west-1.rds.amazonaws.com",
    "DatabasePort": "5432",
    "DatabaseSecretArn": (
        f"arn:aws:secretsmanager:us-west-1:{ACCOUNT}:secret:lai/dev/django/database-AbC"
    ),
    "ArtifactBucketName": ARTIFACTS,
    "AiWorkerFunctionName": "lai-dev-jobs-ai",
    "MediaWorkerFunctionName": "lai-dev-jobs-media",
    "ShutdownScheduleName": "lai-dev-nightly-stop",
    "StartupScheduleName": "lai-dev-morning-start",
    "PowerStateMachineArn": SM_ARN,
    "InfrastructureManagementRoleArn": f"arn:aws:iam::{ACCOUNT}:role/lai-dev-infra",
    "BackendDeploymentRoleArn": f"arn:aws:iam::{ACCOUNT}:role/lai-dev-backend",
    "SiteUrl": SITE,
    "ApiBaseUrl": API,
    "AdminBaseUrl": ADMIN,
    "DeployDocumentName": "lai-dev-native-deploy",
    "ParameterPrefix": "/lai/dev/",
}
PLATFORM_PARAMETERS = {
    "Environment": "dev",
    "AmiId": "ami-0123456789abcdef0",
    "ScheduleTimezone": "America/Los_Angeles",
    "StartupWarmupMinutes": "25",
    "EnableScheduledShutdown": "true",
    "ShutdownHour": "0",
    "ShutdownMinute": "0",
    "StartupHour": "7",
    "StartupMinute": "35",
    "CognitoUserPoolId": POOL,
    "CognitoClientId": CLIENT,
    "AdminAllowedCidr": "",
    "CreateGithubOidcProvider": "true",
    "WorkerCodeKey": "lambda/jobs-worker-0000000000000000.zip",
}


def stack(outputs=None, parameters=None, status="CREATE_COMPLETE", env="dev"):
    return {
        "StackStatus": status,
        "Outputs": outputs or {},
        "Parameters": parameters or {},
        "Tags": {"Project": "learning-adventure-island", "Environment": env},
    }


def healthy_state() -> dict:
    """A deployed, running DEV environment."""
    return {
        "account": ACCOUNT,
        "stacks": {
            "us-west-1/LaiDevArtifacts-dev": stack({"ArtifactBucketName": ARTIFACTS}),
            "us-west-1/LaiAssetStorage-dev": stack({"AssetBucketName": "lai-assets-dev-x"}),
            "us-west-1/LaiChildPhotos-dev": stack(
                {"ChildPhotoBucketName": "lai-child-photos-dev-x"}
            ),
            "us-west-1/LaiAiGuardrail-dev": stack(),
            "us-west-1/LaiDevPlatform-dev": stack(
                dict(PLATFORM_OUTPUTS), dict(PLATFORM_PARAMETERS)
            ),
            "us-east-1/LaiFrontend-dev": stack(
                {
                    "CloudFrontUrl": CLOUDFRONT,
                    "DistributionDomainName": CLOUDFRONT.removeprefix("https://"),
                    "WebBucketName": "lai-web-dev-x",
                    "DistributionId": "E123EXAMPLE",
                    "SiteUrl": SITE,
                    "FrontendDeploymentRoleArn": f"arn:aws:iam::{ACCOUNT}:role/lai-site-dev",
                }
            ),
        },
        "params": {
            "/lai/dev/power/state": {"Value": "running", "Type": "String"},
            "/lai/dev/power/schedule-paused": {"Value": "false", "Type": "String"},
            "/lai/dev/power/hold-until": {"Value": "none", "Type": "String"},
            "/lai/dev/power/last-result": {"Value": "{}", "Type": "String"},
            "/lai/dev/deploy/pending": {"Value": "none", "Type": "String"},
            "/lai/dev/deploy/last-release": {"Value": "{}", "Type": "String"},
        },
        "ec2": "running",
        "rds": "available",
        "ping": "Online",
        "executions": [],
        "exec_outcome": "SUCCEEDED",
        "invocations": {},
        "s3": {},
        "schedules": {
            "lai-dev-nightly-stop": {
                "State": "ENABLED",
                "ScheduleExpression": "cron(0 0 * * ? *)",
                "ScheduleExpressionTimezone": "America/Los_Angeles",
            },
            "lai-dev-morning-start": {
                "State": "ENABLED",
                "ScheduleExpression": "cron(35 7 * * ? *)",
                "ScheduleExpressionTimezone": "America/Los_Angeles",
            },
        },
        "http": {f"{SITE}/api/v1/health/ready/": 200},
        "oidc_providers": [],
        "cognito": "ok",
        "zone": None,
        "changesets": {},
        "templates": {},
        "gh_variables": [],
        "lambda_status": "Successful",
    }


# --- the fakes ------------------------------------------------------------------------------------
class Fail(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def opt(args: list[str], name: str, default=None):
    return args[args.index(name) + 1] if name in args else default


def stack_json(name: str, data: dict) -> dict:
    return {
        "StackName": name,
        "StackStatus": data["StackStatus"],
        "Outputs": [{"OutputKey": k, "OutputValue": v} for k, v in data.get("Outputs", {}).items()],
        "Parameters": [
            {"ParameterKey": k, "ParameterValue": v} for k, v in data.get("Parameters", {}).items()
        ],
        "Tags": [{"Key": k, "Value": v} for k, v in data.get("Tags", {}).items()],
    }


def aws(state: dict, args: list[str]) -> object:
    region = opt(args, "--region", os.environ.get("AWS_REGION", "us-west-1"))
    service, op = args[0], args[1]
    key = (service, op)
    if key == ("sts", "get-caller-identity"):
        if state.get("no_credentials"):
            raise Fail(255, "Unable to locate credentials")
        return {"Account": state["account"], "Arn": f"arn:aws:iam::{state['account']}:user/owner"}

    # CloudFormation
    if service == "cloudformation":
        name = opt(args, "--stack-name")
        sid = f"{region}/{name}"
        if op == "describe-stacks":
            if sid not in state["stacks"]:
                raise Fail(
                    254, f"An error occurred (ValidationError): Stack with id {name} does not exist"
                )
            return {"Stacks": [stack_json(name, state["stacks"][sid])]}
        if op == "validate-template":
            return {"Parameters": []}
        if op == "create-change-set":
            cs = opt(args, "--change-set-name")
            state["changesets"][f"{sid}/{cs}"] = {
                "type": opt(args, "--change-set-type"),
                "parameters": json.loads(opt(args, "--parameters", "[]")),
                "template": opt(args, "--template-body") or opt(args, "--template-url"),
                "executed": False,
            }
            if sid not in state["stacks"]:
                state["stacks"][sid] = {
                    "StackStatus": "REVIEW_IN_PROGRESS",
                    "Tags": {"Environment": "dev"},
                }
            return {"Id": f"arn:cs/{cs}"}
        if op == "describe-change-set":
            return {
                "Status": "CREATE_COMPLETE",
                "Changes": [
                    {
                        "ResourceChange": {
                            "Action": "Modify",
                            "LogicalResourceId": "Thing",
                            "ResourceType": "AWS::SSM::Parameter",
                            "Replacement": "False",
                        }
                    }
                ],
            }
        if op == "execute-change-set":
            cs = opt(args, "--change-set-name")
            state["changesets"][f"{sid}/{cs}"]["executed"] = True
            data = state["stacks"][sid]
            data["StackStatus"] = "UPDATE_COMPLETE" if data.get("Outputs") else "CREATE_COMPLETE"
            return {}
        if op in ("delete-change-set", "describe-stack-events"):
            return {"StackEvents": []}

    # SSM
    if service == "ssm":
        params = state["params"]
        if op == "get-parameter":
            name = opt(args, "--name")
            if name.startswith("/aws/service/ami-amazon-linux-latest/"):
                return {"Parameter": {"Name": name, "Value": "ami-0fedcba9876543210"}}
            if name not in params:
                raise Fail(254, "An error occurred (ParameterNotFound)")
            return {"Parameter": {"Name": name, **params[name]}}
        if op == "put-parameter":
            if "--cli-input-json" in args:
                path = opt(args, "--cli-input-json").removeprefix("file://")
                body = json.loads(Path(path).read_text())
                name, value, ptype, overwrite = (
                    body["Name"],
                    body["Value"],
                    body["Type"],
                    body.get("Overwrite", False),
                )
            else:
                name, value = opt(args, "--name"), opt(args, "--value")
                ptype, overwrite = opt(args, "--type", "String"), "--overwrite" in args
            if name in params and not overwrite:
                raise Fail(254, "An error occurred (ParameterAlreadyExists)")
            params[name] = {"Value": value, "Type": ptype}
            return {"Version": 1}
        if op == "describe-parameters":
            filt = opt(args, "--parameter-filters")
            name = filt.split("Values=", 1)[1]
            return {"Parameters": [{"Name": name}] if name in params else []}
        if op == "delete-parameter":
            name = opt(args, "--name")
            if name not in params:
                raise Fail(254, "An error occurred (ParameterNotFound)")
            del params[name]
            return {}
        if op == "start-session":
            return None
        if op == "describe-instance-information":
            return {"InstanceInformationList": [{"PingStatus": state["ping"]}]}
        if op == "send-command":
            doc = opt(args, "--document-name")
            state.setdefault("sent", []).append(
                {"document": doc, "parameters": json.loads(opt(args, "--parameters"))}
            )
            return {"Command": {"CommandId": f"cmd-{len(state['sent'])}"}}
        if op == "get-command-invocation":
            doc = state["sent"][-1]["document"]
            inv = state["invocations"].get(
                doc, {"Status": "Success", "ResponseCode": 0, "StandardOutputContent": f"{doc} ok"}
            )
            if isinstance(inv, list):  # one answer per call
                inv = inv.pop(0) if len(inv) > 1 else inv[0]
            return inv

    if key == ("ec2", "describe-instances"):
        return {"Reservations": [{"Instances": [{"State": {"Name": state["ec2"]}}]}]}
    if key == ("ec2", "describe-managed-prefix-lists"):
        return {"PrefixLists": [{"PrefixListId": "pl-82a045eb"}]}
    if key == ("rds", "describe-db-instances"):
        return {"DBInstances": [{"DBInstanceStatus": state["rds"], "PubliclyAccessible": False}]}

    # Step Functions
    if service == "stepfunctions":
        if op == "list-executions":
            wanted = opt(args, "--status-filter")
            return {
                "executions": [
                    e for e in state["executions"] if not wanted or e["status"] == wanted
                ]
            }
        if op == "describe-execution":
            arn = opt(args, "--execution-arn")
            return next(e for e in state["executions"] if e["executionArn"] == arn)
        if op == "start-execution":
            payload = json.loads(opt(args, "--input"))
            name = opt(args, "--name")
            arn = f"arn:aws:states:us-west-1:{state['account']}:execution:lai-dev-power:{name}"
            state["executions"].append(
                {
                    "executionArn": arn,
                    "name": opt(args, "--name"),
                    "status": state["exec_outcome"],
                    "input": json.dumps(payload),
                    "startDate": "2026-11-16T00:00:00Z",
                }
            )
            if state["exec_outcome"] == "SUCCEEDED":
                up = payload["action"] == "start"
                state["ec2"] = "running" if up else "stopped"
                state["rds"] = "available" if up else "stopped"
                state["params"]["/lai/dev/power/state"] = {
                    "Value": "running" if up else "stopped",
                    "Type": "String",
                }
            return {"executionArn": arn}

    if key == ("scheduler", "get-schedule"):
        name = opt(args, "--name")
        if name not in state["schedules"]:
            raise Fail(254, "ResourceNotFoundException")
        return {"Name": name, **state["schedules"][name]}

    # S3
    if service == "s3api":
        okey = f"{opt(args, '--bucket')}/{opt(args, '--key')}"
        objects = state["s3"]
        if op == "head-object":
            if okey not in objects:
                raise Fail(254, "Not Found")
            return {"Metadata": objects[okey].get("Metadata", {})}
        if op == "put-object":
            if "--if-none-match" in args and okey in objects:
                raise Fail(254, "PreconditionFailed")
            meta = {}
            if "--metadata" in args:
                k, _, v = opt(args, "--metadata").partition("=")
                meta[k] = v
            objects[okey] = {
                "Metadata": meta,
                "Body": Path(opt(args, "--body")).read_text(errors="replace"),
            }
            return {"ETag": '"x"'}
        if op == "get-object":
            if okey not in objects:
                raise Fail(254, "NoSuchKey")
            Path(args[-3] if args[-2] == "--output" else args[-1]).write_text(objects[okey]["Body"])
            return {}

    if service == "lambda":
        if op == "update-function-code":
            state.setdefault("lambda_updates", []).append(
                {"function": opt(args, "--function-name"), "key": opt(args, "--s3-key")}
            )
            return {}
        if op == "get-function":
            return {"Configuration": {"LastUpdateStatus": state["lambda_status"]}}

    if key == ("iam", "list-open-id-connect-providers"):
        return {"OpenIDConnectProviderList": [{"Arn": a} for a in state["oidc_providers"]]}
    if key == ("route53", "get-hosted-zone"):
        if not state["zone"]:
            raise Fail(254, "NoSuchHostedZone")
        return {"HostedZone": state["zone"]}
    if service == "cognito-idp":
        if state["cognito"] == "denied":
            raise Fail(254, "An error occurred (AccessDeniedException)")
        if state["cognito"] == "missing":
            raise Fail(254, "ResourceNotFoundException")
        return {"UserPool": {"Id": opt(args, "--user-pool-id")}}
    if service == "acm":
        return {"CertificateSummaryList": []}
    if key == ("logs", "tail"):
        return None
    raise Fail(99, f"fake aws: unhandled {' '.join(args)}")


def gh(state: dict, args: list[str]) -> str:
    if args[:2] == ["repo", "view"]:
        return "owner/repo"
    if args[:2] == ["variable", "list"]:
        return "\n".join(state["gh_variables"])
    if args[:2] == ["variable", "set"]:
        state["gh_variables"].append(args[2])
        return ""
    if args[0] == "api":
        if state.get("gh_fail"):
            raise Fail(1, "gh api failed")
        return ""
    raise Fail(99, f"fake gh: unhandled {args}")


def npm(state: dict, args: list[str]) -> str:
    if "infra:synth" in args:
        out = Path(os.environ["CDK_OUTDIR"])
        out.mkdir(parents=True, exist_ok=True)
        state["synth_digest"] = os.environ.get("LAI_PROCESSING_WORKER_IMAGE_DIGEST")
        for name in (
            "LaiDevArtifacts-dev",
            "LaiAssetStorage-dev",
            "LaiChildPhotos-dev",
            "LaiProcessing-dev",
            "LaiAiGuardrail-dev",
            "LaiDevPlatform-dev",
            "LaiProcessingImages-dev",
            "LaiFrontend-dev",
        ):
            template = state["templates"].get(name, {"Resources": {}})
            (out / f"{name}.template.json").write_text(json.dumps(template))
        return ""
    return ""


def curl(state: dict, args: list[str]) -> str:
    url, out, fmt = args[-1], None, ""
    for i, a in enumerate(args[:-1]):
        if a == "-o":
            out = args[i + 1]
        if a == "-w":
            fmt = args[i + 1]
    entry = state["http"].get(url, 0)
    code, body = (entry, '<div id="root"></div>') if isinstance(entry, int) else entry
    if out and out != "/dev/null":
        Path(out).write_text(body)
    return fmt.replace("%{http_code}", f"{code:03d}")


def main() -> int:
    command, args = sys.argv[1], sys.argv[2:]
    state_dir = Path(os.environ["FAKE_STATE"])
    with (state_dir / "calls.log").open("a") as calls:
        calls.write(json.dumps([command, *args]) + "\n")
    path = state_dir / "state.json"
    state = json.loads(path.read_text())
    try:
        result = {"aws": aws, "gh": gh, "npm": npm, "curl": curl}[command](state, args)
    except Fail as failure:
        print(str(failure), file=sys.stderr)
        path.write_text(json.dumps(state))
        return failure.code
    path.write_text(json.dumps(state))
    if command == "aws":
        if result is not None:
            print(json.dumps(result))
    elif result:
        sys.stdout.write(result if command == "curl" else result + "\n")
    return 0


# --- test harness ---------------------------------------------------------------------------------
class DevEnv:
    def __init__(self, tmp_path: Path):
        self.tmp = tmp_path
        self.root = tmp_path / "repo"
        aws_dir = self.root / "scripts/aws"
        (aws_dir / "native").mkdir(parents=True)
        for name in SCRIPTS:
            shutil.copy(REPO / "scripts/aws" / name, aws_dir / name)
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        for name in ("aws", "gh", "npm", "curl"):
            fake = self.bin / name
            fake.write_text(f'#!/bin/sh\nexec "{sys.executable}" -S -E "{FAKE}" {name} "$@"\n')
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.state_dir = tmp_path / "state"
        self.state_dir.mkdir()
        self.env_file = tmp_path / "empty.env"
        self.env_file.write_text("")
        self.state = healthy_state()
        self.save()

    def save(self) -> None:
        (self.state_dir / "state.json").write_text(json.dumps(self.state))

    def load(self) -> dict:
        self.state = json.loads((self.state_dir / "state.json").read_text())
        return self.state

    def script(self, name: str, body: str) -> Path:
        """Replace a collaborator script (package-lambda.sh, native/package-release.sh)."""
        path = self.root / "scripts/aws" / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body)
        path.chmod(0o755)
        return path

    def calls(self, command: str | None = None) -> list[list[str]]:
        log = self.state_dir / "calls.log"
        rows = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return [row for row in rows if command is None or row[0] == command]

    def aws_ops(self) -> list[str]:
        return [f"{c[1]} {c[2]}" for c in self.calls("aws")]

    def run(
        self, script: str, *args: str, stdin: str = "", **env: str
    ) -> subprocess.CompletedProcess:
        self.save()
        full_env = {
            **{
                k: v for k, v in os.environ.items() if not k.startswith(("LAI_", "AWS_", "GITHUB_"))
            },
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_STATE": str(self.state_dir),
            "LAI_DEV_ENV_FILE": str(self.env_file),
            "LAI_SSM_POLL_SECONDS": "0",
            "LAI_POWER_POLL_SECONDS": "0",
            "LAI_CFN_POLL_SECONDS": "0",
            "LAI_LAMBDA_POLL_SECONDS": "0",
            "LAI_SETUP_POLL_SECONDS": "0",
            "NO_COLOR": "1",
            **env,
        }
        result = subprocess.run(
            ["bash", str(self.root / "scripts/aws" / script), *args],
            env=full_env,
            capture_output=True,
            text=True,
            input=stdin,
            timeout=120,
        )
        self.load()
        return result


if __name__ == "__main__":
    sys.exit(main())
