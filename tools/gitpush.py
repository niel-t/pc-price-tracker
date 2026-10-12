"""Helpers for the scheduled jobs on your PC (deals.py, build_catalog.py): logging and git push."""
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / "local.json"  # not committed; e.g. {"ntfy_topic": "...", "notify_deals": true}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # no console flashes when run by Task Scheduler


def setup_log(name: str):
    """With --log, append all output to logs/<name>.log (pythonw.exe has no console)."""
    if "--log" not in sys.argv and sys.stdout is not None:
        return
    (ROOT / "logs").mkdir(exist_ok=True)
    sys.stdout = sys.stderr = open(ROOT / "logs" / f"{name}.log", "a", encoding="utf-8", buffering=1)
    print(f"\n=== {datetime.now():%Y-%m-%d %H:%M:%S} ===")


def local_config() -> dict:
    return json.loads(LOCAL.read_text(encoding="utf-8")) if LOCAL.exists() else {}


def _git_exe() -> str:
    return shutil.which("git") or r"C:\Program Files\Git\cmd\git.exe"


def git(*args, check=True, capture=False):
    return subprocess.run([_git_exe(), *args], cwd=ROOT, check=check, creationflags=NO_WINDOW,
                          capture_output=capture, text=True)


def push(path: str, message: str):
    """Commit just `path` (if it changed) on top of the latest main, and push."""
    git("pull", "--rebase", "--autostash", "-q", "origin", "main")
    tracked = git("ls-files", "--error-unmatch", path, check=False, capture=True).returncode == 0
    if tracked and git("diff", "--quiet", "--", path, check=False).returncode == 0:
        print(f"{path}: no changes to push")
        return
    git("add", path)
    git("commit", "-q", "-m", message, "--", path)
    git("push", "-q", "origin", "main")
    print(f"Pushed {path}")
