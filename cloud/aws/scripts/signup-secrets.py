#!/usr/bin/env python3
"""Copy GitHub Actions secrets into this project's encrypted AWS parameters."""
import json
import os
from pathlib import Path
import subprocess
import sys

PARAMETERS = {
    "BREVO_API_KEY": "/big-naturals-food-co/signup/brevo-api-key",
    "TURNSTILE_SECRET": "/big-naturals-food-co/signup/turnstile-secret",
}


def aws(region, *args, payload=None):
    # Provider keys reach the CLI only through stdin, never argv or inherited env.
    environment = {key: value for key, value in os.environ.items() if key not in PARAMETERS}
    result = subprocess.run(
        ["aws", "--region", region, "--no-cli-pager", *args],
        input=json.dumps(payload) if payload is not None else None,
        text=True, capture_output=True, env=environment,
    )
    if result.returncode:
        # CLI errors can include request bodies. Never echo captured output.
        raise RuntimeError(f"AWS {args[0]} {args[1]} failed. Check deployment permissions and credentials.")
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
        aws(project["region"], "ssm", "put-parameter", "--cli-input-json", "file:///dev/stdin", payload={
            "Name": parameter, "Type": "SecureString", "Value": values[name], "Overwrite": True,
        })
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
