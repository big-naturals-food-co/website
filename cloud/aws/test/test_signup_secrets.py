import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("signup_secrets", Path(__file__).resolve().parent.parent / "scripts/signup-secrets.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PROJECT = {"region": "us-east-1", "account": "111111111111"}
IDENTITY = {"Account": PROJECT["account"], "Arn": "arn:aws:sts::111111111111:assumed-role/project-deploy/run"}
SECRETS = {"BREVO_API_KEY": "private-brevo-test", "TURNSTILE_SECRET": "private-turnstile-test"}


class SignupSecretsTest(unittest.TestCase):
    def test_disabled_and_missing_keys_make_no_aws_calls(self):
        with patch.object(module, "aws") as aws, contextlib.redirect_stdout(io.StringIO()):
            module.sync(PROJECT, {"enabled": False}, {})
            with self.assertRaisesRegex(RuntimeError, "both repository"):
                module.sync(PROJECT, {"enabled": True}, {"BREVO_API_KEY": "one-key"})
            aws.assert_not_called()

    def test_wrong_account_and_root_cannot_write(self):
        for identity in [{**IDENTITY, "Account": "222222222222"}, {**IDENTITY, "Arn": "arn:aws:iam::111111111111:root"}]:
            with patch.object(module, "aws", return_value=identity) as aws:
                with self.assertRaisesRegex(RuntimeError, "deployment credentials"):
                    module.sync(PROJECT, {"enabled": True}, SECRETS)
                self.assertEqual(aws.call_count, 1)

    def test_sync_uses_only_project_securestrings_and_does_not_print_secrets(self):
        output = io.StringIO()
        with patch.object(module, "aws", side_effect=[IDENTITY, {}, {}]) as aws, contextlib.redirect_stdout(output):
            module.sync(PROJECT, {"enabled": True}, SECRETS)
        for call, (name, parameter) in zip(aws.call_args_list[1:], module.PARAMETERS.items()):
            self.assertEqual(call.args, (PROJECT["region"], "ssm", "put-parameter", "--name", parameter,
                "--type", "SecureString", "--value", "file:///dev/stdin", "--overwrite"))
            self.assertEqual(call.kwargs["stdin"], SECRETS[name])
        for secret in SECRETS.values():
            self.assertNotIn(secret, output.getvalue())

    def test_cli_transports_secret_on_stdin_only(self):
        with patch.dict(module.os.environ, SECRETS), patch.object(module.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout='{}')) as run:
            module.aws("us-east-1", "ssm", "put-parameter", "--value", "file:///dev/stdin", stdin=SECRETS["BREVO_API_KEY"])
        call = run.call_args
        self.assertEqual(call.kwargs["input"], SECRETS["BREVO_API_KEY"])
        self.assertNotIn(SECRETS["BREVO_API_KEY"], str(call.args))
        self.assertNotIn("BREVO_API_KEY", call.kwargs["env"])
        self.assertNotIn("TURNSTILE_SECRET", call.kwargs["env"])
        self.assertIn("--no-cli-auto-prompt", call.args[0])

    def test_cli_failure_does_not_expose_upstream_error_or_continue_writing(self):
        with patch.object(module.subprocess, "run", return_value=types.SimpleNamespace(returncode=1, stdout=SECRETS["BREVO_API_KEY"], stderr=SECRETS["BREVO_API_KEY"])):
            with self.assertRaises(RuntimeError) as raised:
                module.aws("us-east-1", "ssm", "put-parameter")
            self.assertNotIn(SECRETS["BREVO_API_KEY"], str(raised.exception))
        with patch.object(module, "aws", side_effect=[IDENTITY, RuntimeError("failed")]) as aws:
            with self.assertRaises(RuntimeError):
                module.sync(PROJECT, {"enabled": True}, SECRETS)
            self.assertEqual(aws.call_count, 2)

    def test_known_errors_report_only_a_safe_code_and_fixed_explanation(self):
        for code in ["AccessDeniedException", "ParamValidation", SECRETS["BREVO_API_KEY"]]:
            error = f"An error occurred ({code}) when calling PutParameter: {SECRETS['TURNSTILE_SECRET']}"
            with patch.object(module.subprocess, "run", return_value=types.SimpleNamespace(returncode=252, stdout='', stderr=error)):
                with self.assertRaises(RuntimeError) as raised:
                    module.aws("us-east-1", "ssm", "put-parameter")
            text = str(raised.exception)
            for secret in SECRETS.values():
                self.assertNotIn(secret, text)
            if code in ["AccessDeniedException", "ParamValidation"]:
                self.assertIn(code, text)

    @unittest.skipUnless(shutil.which("aws"), "AWS CLI is needed for the offline input regression test")
    def test_real_cli_accepts_piped_values_without_aws_access(self):
        # Exercise sync's actual CLI arguments, with dummy credentials and output
        # skeleton validation only. No requests or writes reach AWS.
        real_run = subprocess.run
        calls = []
        def offline_run(command, **kwargs):
            if "get-caller-identity" in command:
                return types.SimpleNamespace(returncode=0, stdout=json.dumps(IDENTITY))
            calls.append(command)
            return real_run([*command, "--generate-cli-skeleton", "output",
                "--endpoint-url", "http://127.0.0.1:9"], **kwargs, timeout=15)
        environment = {k: v for k, v in os.environ.items() if not k.startswith("AWS_")}
        environment.update({
            "AWS_ACCESS_KEY_ID": "dummy", "AWS_SECRET_ACCESS_KEY": "dummy",
            "AWS_EC2_METADATA_DISABLED": "true", "AWS_CONFIG_FILE": os.devnull,
            "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
        })
        with patch.dict(module.os.environ, environment, clear=True), patch.object(module.subprocess, "run", side_effect=offline_run), contextlib.redirect_stdout(io.StringIO()):
            module.sync(PROJECT, {"enabled": True}, {
                "BREVO_API_KEY": 'dummy "quoted" key \\ with spaces',
                "TURNSTILE_SECRET": 'dummy-unicode-é\nsecond-line',
            })
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
