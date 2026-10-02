#!/usr/bin/env python3
"""Poll a qualified branch and replace one Compose service, with app rollback."""

import argparse
import base64
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request


REPOSITORY = "HDNG-AI/sales-portal"
BRANCH = "odelco-staging"
WORKFLOW = "odelco-staging.yml"
SHA = re.compile(r"[0-9a-f]{40}\Z")


class Stop(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise Stop(reason)


def read_private(path):
    path = Path(path)
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == 0
            and not s.st_mode & 0o077, "private_file_permissions")
    return path.read_text()


def write_json(path, value):
    path = Path(path)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".write-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def command(args, *, env=None, cwd=None, timeout=120):
    try:
        result = subprocess.run(args, cwd=cwd, env=env, text=True,
                                capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Stop("command_timeout") from None
    # Tool output may contain resolved environment values. Never emit it.
    require(result.returncode == 0, "command_failed:" + args[0])
    return result.stdout.strip()


def api(path, token):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPOSITORY + "/" + path,
        headers={"Authorization": "Bearer " + token,
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def qualified_run(runs, sha):
    eligible = [r for r in runs if r.get("head_sha") == sha
                and r.get("head_branch") == BRANCH
                and r.get("event") == "push"
                and r.get("head_repository", {}).get("full_name") == REPOSITORY]
    if not eligible:
        return False
    latest = max(eligible, key=lambda r: (r["id"], r.get("run_attempt", 1)))
    return latest.get("status") == "completed" and latest.get("conclusion") == "success"


def escape_compose(value):
    if isinstance(value, str):
        return value.replace("$", "$$")
    if isinstance(value, list):
        return [escape_compose(v) for v in value]
    if isinstance(value, dict):
        return {k: escape_compose(v) for k, v in value.items()}
    return value


def inspect_container(name):
    return json.loads(command(["docker", "inspect", name]))[0]


def validate_model(model, live, service, expected_networks):
    require(set(model.get("services", {})) == {service}, "single_service_required")
    s = model["services"][service]
    require(not s.get("build"), "baseline_must_use_built_image")
    require(not live.get("Mounts"), "unexpected_runtime_mounts")
    require(not s.get("volumes"), "unexpected_compose_mounts")
    require(set(live["NetworkSettings"]["Networks"]) == set(expected_networks),
            "runtime_network_drift")
    env = dict(v.split("=", 1) for v in live["Config"].get("Env", []))
    expected = s.get("environment", {})
    require(isinstance(expected, dict), "unresolved_environment")
    require(all(v is not None and str(v) == env.get(k) for k, v in expected.items()),
            "runtime_environment_drift")
    require(env.get("NUXT_STORAGE_DRIVER") == "redis", "redis_required")
    require(bool(env.get("NUXT_STORAGE_REDIS_URL")), "redis_url_missing")
    return env


def candidate_model(baseline, service, image):
    result = copy.deepcopy(baseline)
    result["services"][service]["image"] = image
    return result


def activate_with_rollback(activate, verify, rollback, verify_rollback, record_recovery):
    try:
        activate()
        verify()
    except BaseException:
        print("STAGE=rollback", flush=True)
        rollback()
        verify_rollback()
        record_recovery()
        raise


def public_check(config):
    origin = config["origin"].rstrip("/")
    require(origin.startswith("https://"), "https_required")
    for path in ("/api/health", "/api/config", config["storefront_path"]):
        request = urllib.request.Request(origin + path + "?deploy_check=" + str(time.time_ns()),
                                         headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=20) as response:
            require(response.status == 200, "public_http_failed")
            if path == "/api/health":
                require(json.load(response).get("status") == "healthy", "public_unhealthy")
            elif path == "/api/config":
                data = json.load(response)
                require(data.get("tenantId") == config["tenant_id"], "tenant_mismatch")
                for key, value in config["expected_layout"].items():
                    require(data.get("layout", {}).get(key) == value, "layout_mismatch")
            else:
                require(bool(response.read(1024)), "empty_storefront")


def healthy(config, image):
    for _ in range(45):
        c = inspect_container(config["container"])
        require(c["Image"] == image, "runtime_image_mismatch")
        state = c["State"]
        if state.get("Health", {}).get("Status") == "healthy":
            public_check(config)
            return
        require(state["Status"] in ("running", "restarting"), "container_stopped")
        time.sleep(4)
    raise Stop("health_timeout")


def prepare_source(root, sha, token):
    repo = root / "repository.git"
    if not repo.exists():
        command(["git", "init", "--bare", str(repo)])
    env = dict(os.environ)
    auth = base64.b64encode(("x-access-token:" + token).encode()).decode()
    env.update({"GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + auth,
                "GIT_CONFIG_KEY_1": "core.hooksPath", "GIT_CONFIG_VALUE_1": "/dev/null",
                "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_NOSYSTEM": "1"})
    command(["git", "--git-dir", str(repo), "fetch", "--depth=1", "--no-tags",
             "https://github.com/" + REPOSITORY + ".git", "refs/heads/" + BRANCH],
            env=env, timeout=180)
    fetched = command(["git", "--git-dir", str(repo), "rev-parse", "FETCH_HEAD"])
    require(fetched == sha, "branch_moved_during_fetch")
    release = Path(tempfile.mkdtemp(prefix=sha[:12] + "-", dir=root))
    archive = release / "source.tar"
    command(["git", "--git-dir", str(repo), "archive", "--format=tar", "-o", str(archive), sha])
    source = release / "source"
    source.mkdir()
    with tarfile.open(archive) as tar:
        tar.extractall(source, filter="data")
    archive.unlink()
    return release, source


def preflight(config):
    live = inspect_container(config["container"])
    require(live["Image"] == config["initial_image"], "initial_image_changed")
    labels = live["Config"].get("Labels") or {}
    require(labels.get("com.docker.compose.project") == config["project"], "project_mismatch")
    require(labels.get("com.docker.compose.service") == config["service"], "service_mismatch")
    file = labels.get("com.docker.compose.project.config_files", "")
    require(file.startswith("/") and "," not in file, "single_absolute_compose_required")
    def compose(path, *args):
        return ["docker", "compose", "--project-name", config["project"], "-f", str(path), *args]
    model = json.loads(command(compose(file, "config", "--format", "json")))
    validate_model(model, live, config["service"], config["networks"])
    with tempfile.TemporaryDirectory(prefix="staging-preflight-") as temporary:
        frozen = Path(temporary) / "compose.json"
        write_json(frozen, escape_compose(model))
        require(json.loads(command(compose(frozen, "config", "--format", "json"))) == model,
                "baseline_roundtrip_mismatch")
        hashes = command(compose(frozen, "config", "--hash", config["service"])).split()
        require(bool(hashes) and hashes[-1] == labels.get("com.docker.compose.config-hash"),
                "effective_compose_drift")
    healthy(config, config["initial_image"])
    print("SERVER_PREFLIGHT=PASS; LIVE_SERVICES_UNCHANGED")


def publish(config, sha, token, state_path, state):
    root = state_path.parent
    live = inspect_container(config["container"])
    expected_image = state.get("image", config["initial_image"])
    require(live["Image"] == expected_image, "unrecorded_live_image")
    labels = live["Config"].get("Labels") or {}
    project, service = config["project"], config["service"]
    require(labels.get("com.docker.compose.project") == project, "project_mismatch")
    require(labels.get("com.docker.compose.service") == service, "service_mismatch")
    compose_file = labels.get("com.docker.compose.project.config_files", "")
    require(compose_file.startswith("/") and "," not in compose_file, "single_absolute_compose_required")

    def compose(file, *args):
        return ["docker", "compose", "--project-name", project, "-f", str(file), *args]

    baseline = json.loads(command(compose(compose_file, "config", "--format", "json")))
    environment = validate_model(baseline, live, service, config["networks"])
    source_image = baseline["services"][service]["image"]
    require(json.loads(command(["docker", "image", "inspect", source_image]))[0]["Id"] == expected_image,
            "compose_image_drift")
    healthy(config, expected_image)
    print("STAGE=build", flush=True)
    release, source = prepare_source(root, sha, token)
    rollback = release / "rollback.compose.json"
    # Pin rollback to the actual running image, never to a movable tag.
    baseline["services"][service]["image"] = expected_image
    write_json(rollback, escape_compose(baseline))
    require(json.loads(command(compose(rollback, "config", "--format", "json"))) == baseline,
            "baseline_roundtrip_mismatch")
    # An image-only replacement must not silently pick up other Compose edits.
    original_model = copy.deepcopy(baseline)
    original_model["services"][service]["image"] = source_image
    baseline_check = release / "baseline.compose.json"
    write_json(baseline_check, escape_compose(original_model))
    hashes = command(compose(baseline_check, "config", "--hash", service)).split()
    require(bool(hashes) and hashes[-1] == labels.get("com.docker.compose.config-hash"),
            "effective_compose_drift")
    build_env = dict(os.environ)
    build_env["NUXT_STORAGE_DRIVER"] = "redis"
    build_env["NUXT_STORAGE_REDIS_URL"] = environment["NUXT_STORAGE_REDIS_URL"]
    iid = release / "image-id"
    command(["docker", "build", "--iidfile", str(iid),
             "--label", "org.opencontainers.image.revision=" + sha,
             "--build-arg", "COMMIT_SHA=" + sha,
             "--build-arg", "NUXT_STORAGE_DRIVER", "--build-arg", "NUXT_STORAGE_REDIS_URL",
             str(source)], env=build_env, timeout=1800)
    image = iid.read_text().strip()
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image), "invalid_image_id")
    model = candidate_model(baseline, service, image)
    candidate = release / "deploy.compose.json"
    write_json(candidate, escape_compose(model))
    require(json.loads(command(compose(candidate, "config", "--format", "json"))) == model,
            "candidate_roundtrip_mismatch")
    require(api("git/ref/heads/" + BRANCH, token)["object"]["sha"] == sha, "branch_moved_during_build")
    query = urllib.parse.urlencode({"branch": BRANCH, "head_sha": sha, "event": "push", "per_page": 100})
    require(qualified_run(api("actions/workflows/" + WORKFLOW + "/runs?" + query, token)["workflow_runs"], sha),
            "checks_changed_during_build")
    current = inspect_container(config["container"])
    require(current["Id"] == live["Id"] and current["Image"] == expected_image,
            "container_changed_during_build")
    journal = {"phase": "activating", "sha": sha, "previous": state,
               "rollback": str(rollback), "candidate": str(candidate), "old_image": expected_image}
    write_json(state_path, journal)
    print("STAGE=activate", flush=True)
    up_args = ("up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", service)
    activate_with_rollback(
        lambda: command(compose(candidate, *up_args), timeout=180),
        lambda: healthy(config, image),
        lambda: command(compose(rollback, *up_args), timeout=180),
        lambda: healthy(config, expected_image),
        lambda: write_json(state_path, dict(state, phase="ready", failed_sha=sha)),
    )
    write_json(state_path, {"phase": "ready", "sha": sha, "image": image,
                            "rollback": str(rollback), "old_image": expected_image})
    print("STAGING_ACCEPTANCE=PASS sha=" + sha, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    args = parser.parse_args()
    require(os.geteuid() == 0, "root_required")
    os.umask(0o077)
    config = json.loads(read_private(args.config))
    require(not (args.preflight and args.apply), "choose_preflight_or_apply")
    if args.preflight:
        preflight(config)
        return
    require(config.get("enabled") is True, "deployment_not_enabled")
    token = read_private(config["token_file"]).strip()
    require(bool(token), "token_missing")
    root = Path(config["state_directory"])
    require(root.is_absolute(), "absolute_state_directory_required")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    s = root.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o077,
            "private_state_directory_required")
    with (root / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_path = root / "state.json"
        state = json.loads(read_private(state_path)) if state_path.exists() else {}
        require(state.get("phase", "ready") == "ready", "interrupted_deploy_requires_recovery")
        sha = api("git/ref/heads/" + BRANCH, token)["object"]["sha"]
        require(SHA.fullmatch(sha), "invalid_revision")
        if sha in (state.get("sha"), state.get("failed_sha")):
            print("STAGING=no_new_revision")
            return
        query = urllib.parse.urlencode({"branch": BRANCH, "head_sha": sha, "event": "push", "per_page": 100})
        runs = api("actions/workflows/" + WORKFLOW + "/runs?" + query, token)["workflow_runs"]
        require(qualified_run(runs, sha), "waiting_for_successful_push_checks")
        print("QUALIFIED_SHA=" + sha)
        if args.apply:
            publish(config, sha, token, state_path, state)
        else:
            print("CHECK_ONLY=no_live_changes")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(Stop("terminated")))
    try:
        main()
    except Exception as exc:
        # Never print arbitrary exception text: URLs or subprocesses may include secrets.
        print("STOP=" + (str(exc) if isinstance(exc, Stop) else type(exc).__name__), flush=True)
        raise SystemExit(1) from None
