import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("publish", ROOT / "infra/staging/publish.py")
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.run = {"id": 42, "head_sha": self.sha, "head_branch": "odelco-staging",
                    "head_repository": {"full_name": "HDNG-AI/sales-portal"},
                    "event": "push", "status": "completed", "conclusion": "success"}

    def test_exact_successful_push_is_accepted(self):
        self.assertTrue(publish.qualified_run([self.run], self.sha))

    def test_pr_fork_other_branch_old_sha_and_failed_runs_do_not_deploy(self):
        for patch in ({"event": "pull_request"}, {"head_branch": "main"},
                      {"head_sha": "b" * 40}, {"conclusion": "failure"},
                      {"head_repository": {"full_name": "another/sales-portal"}},
                      {"status": "in_progress"}):
            with self.subTest(patch=patch):
                self.assertFalse(publish.qualified_run([dict(self.run, **patch)], self.sha))

    def test_new_failure_or_pending_run_overrides_old_success(self):
        for status in ("queued", "in_progress", "completed"):
            newer = dict(self.run, id=43, status=status, conclusion="failure")
            self.assertFalse(publish.qualified_run([self.run, newer], self.sha))


class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.model = {"services": {"portal": {"image": "sha256:old", "environment": {
            "NUXT_STORAGE_DRIVER": "redis", "NUXT_STORAGE_REDIS_URL": "redis://local/0",
            "SECRET": "literal${NOT_AN_ENV}$value"}}}, "networks": {"edge": {"external": True}}}
        self.live = {"Mounts": [], "NetworkSettings": {"Networks": {"edge": {}}},
                     "Config": {"Env": [k + "=" + v for k, v in
                                          self.model["services"]["portal"]["environment"].items()]}}

    def test_candidate_changes_only_image_and_does_not_mutate_baseline(self):
        original = copy.deepcopy(self.model)
        candidate = publish.candidate_model(self.model, "portal", "sha256:new")
        self.assertEqual(self.model, original)
        candidate["services"]["portal"]["image"] = "sha256:old"
        self.assertEqual(candidate, original)

    def test_secret_dollars_are_escaped_without_modifying_values_in_memory(self):
        result = publish.escape_compose(self.model)
        self.assertEqual(result["services"]["portal"]["environment"]["SECRET"],
                         "literal$${NOT_AN_ENV}$$value")
        self.assertEqual(self.model["services"]["portal"]["environment"]["SECRET"],
                         "literal${NOT_AN_ENV}$value")

    def test_runtime_drift_and_memory_storage_stop_before_replacement(self):
        publish.validate_model(self.model, self.live, "portal", ["edge"])
        self.live["Config"]["Env"][0] = "NUXT_STORAGE_DRIVER=memory"
        with self.assertRaises(publish.Stop):
            publish.validate_model(self.model, self.live, "portal", ["edge"])

    def test_additional_services_cannot_be_recreated(self):
        self.model["services"]["redis"] = {"image": "redis"}
        with self.assertRaises(publish.Stop):
            publish.validate_model(self.model, self.live, "portal", ["edge"])


class RecoveryTests(unittest.TestCase):
    def test_failed_acceptance_restores_and_verifies_old_app(self):
        events = []
        def fail():
            events.append("failed-check")
            raise publish.Stop("wrong_tenant")
        with self.assertRaises(publish.Stop):
            publish.activate_with_rollback(lambda: events.append("activate"), fail,
                                           lambda: events.append("restore"),
                                           lambda: events.append("verify-old"),
                                           lambda: events.append("record"))
        self.assertEqual(events, ["activate", "failed-check", "restore", "verify-old", "record"])

    def test_failed_rollback_keeps_interrupted_journal(self):
        events = []
        def fail():
            raise publish.Stop("failed")
        with self.assertRaises(publish.Stop):
            publish.activate_with_rollback(fail, fail, fail, fail, lambda: events.append("record"))
        self.assertEqual(events, [])

    def test_atomic_journal_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            publish.write_json(path, {"phase": "activating"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
