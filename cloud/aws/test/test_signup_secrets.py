import contextlib
import importlib.util
import io
import json
from pathlib import Path
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
            self.assertEqual(call.kwargs["payload"], {"Name": parameter, "Type": "SecureString", "Value": SECRETS[name], "Overwrite": True})
        for secret in SECRETS.values():
            self.assertNotIn(secret, output.getvalue())

    def test_cli_transports_secret_on_stdin_only(self):
        with patch.dict(module.os.environ, SECRETS), patch.object(module.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout='{}')) as run:
            module.aws("us-east-1", "ssm", "put-parameter", "--cli-input-json", "file:///dev/stdin", payload={"Value": SECRETS["BREVO_API_KEY"]})
        call = run.call_args
        self.assertEqual(json.loads(call.kwargs["input"]), {"Value": SECRETS["BREVO_API_KEY"]})
        self.assertNotIn(SECRETS["BREVO_API_KEY"], str(call.args))
        self.assertNotIn("BREVO_API_KEY", call.kwargs["env"])
        self.assertNotIn("TURNSTILE_SECRET", call.kwargs["env"])

    def test_cli_failure_does_not_expose_upstream_error_or_continue_writing(self):
        with patch.object(module.subprocess, "run", return_value=types.SimpleNamespace(returncode=1, stdout=SECRETS["BREVO_API_KEY"], stderr=SECRETS["BREVO_API_KEY"])):
            with self.assertRaises(RuntimeError) as raised:
                module.aws("us-east-1", "ssm", "put-parameter")
            self.assertNotIn(SECRETS["BREVO_API_KEY"], str(raised.exception))
        with patch.object(module, "aws", side_effect=[IDENTITY, RuntimeError("failed")]) as aws:
            with self.assertRaises(RuntimeError):
                module.sync(PROJECT, {"enabled": True}, SECRETS)
            self.assertEqual(aws.call_count, 2)


if __name__ == "__main__":
    unittest.main()
