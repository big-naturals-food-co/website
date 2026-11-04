#!/usr/bin/env python3
"""Copy GitHub Actions secrets into this project's encrypted AWS parameters."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PARAMETERS = {
    "BREVO_API_KEY": "/big-naturals-food-co/signup/brevo-api-key",
    "TURNSTILE_SECRET": "/big-naturals-food-co/signup/turnstile-secret",
}


def aws(region, *args, stdin=None):
    # Provider keys reach the CLI only through stdin, never argv or inherited env.
    environment = {key: value for key, value in os.environ.items() if key not in PARAMETERS}
    result = subprocess.run(
        ["aws", "--region", region, "--no-cli-pager", "--no-cli-auto-prompt", "--output", "json", *args],
        input=stdin,
        text=True, capture_output=True, env=environment,
    )
    if result.returncode:
        # CLI errors can include request bodies. Report only known error labels.
        match = re.search(r"An error occurred \(([A-Za-z0-9]+)\)", result.stderr)
        code = match.group(1) if match else None
        explanations = {
            "AccessDenied": "Check the deployment role's permissions.",
            "AccessDeniedException": "Check the deployment role's permissions.",
            "ParamValidation": "The AWS CLI rejected the request input.",
            "ValidationException": "AWS rejected the parameter settings.",
            "InvalidKeyId": "Check the SSM encryption key configuration.",
            "ExpiredToken": "The AWS session expired.",
            "ExpiredTokenException": "The AWS session expired.",
            "ThrottlingException": "AWS rate-limited the request; retry the deployment.",
            "TooManyUpdates": "Another update is in progress; retry the deployment.",
        }
        detail = f"{code}: {explanations[code]}" if code in explanations else f"AWS CLI exit {result.returncode}; raw output withheld to protect secrets."
        raise RuntimeError(f"AWS {args[0]} {args[1]} failed. {detail}")
    return json.loads(result.stdout)


def sync(project, signup, environment):
    if not signup["enabled"]:
        print("Signup is disabled; existing AWS parameters are unchanged.")
        return
    values = {name: environment.get(name, "").strip() for name in PARAMETERS}
    if any(not value for value in values.values()):
        raise RuntimeError("Set both repository Actions secrets: BREVO_API_KEY and TURNSTILE_SECRET. No parameters were written.")
    identity = aws(project["region"], "sts", "get-caller-identity")
    if identity["Account"] != project["account"] or identity["Arn"].endswith(":root"):
        raise RuntimeError("Use deployment credentials in the configured Big Naturals AWS account; root is not allowed.")
    for name, parameter in PARAMETERS.items():
        # --cli-input-json can open its input more than once, exhausting a pipe.
        # A single --value file argument reads stdin once; metadata is non-secret.
        aws(project["region"], "ssm", "put-parameter",
            "--name", parameter, "--type", "SecureString",
            "--value", "file:///dev/stdin", "--overwrite", stdin=values[name])
        print(f"Stored {parameter} (encrypted).")


def main():
    directory = Path(__file__).resolve().parent.parent
    project = json.loads((directory / "project.json").read_text())
    signup = json.loads((directory.parent / "signup.json").read_text())
    sync(project, signup, os.environ)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyboardInterrupt) as error:
        print(str(error) or "Cancelled.", file=sys.stderr)
        sys.exit(1)
