"""Sandboxed shell bridge for the Dev Core / OS agent.

Policy (development sandbox, as chosen by the user):
  * SAFE       -> runs immediately, no confirmation
  * CONFIRM    -> needs an explicit confirm=true round trip (rm -rf, sudo, kill, chmod ...)
  * BLOCKED    -> never runs (disk wipes, fork bombs, shutdown)
"""

import asyncio
import re
import shlex

WORKDIR = "/app"
TIMEOUT_SEC = 25
MAX_OUTPUT = 12000

# Catastrophic / irreversible beyond the sandbox — refused outright.
BLOCKED_PATTERNS = [
    r"\bmkfs(\.\w+)?\b",
    r"\bdd\b[^|]*of=/dev/",
    r">\s*/dev/sd",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\binit\s+0\b",
    r":\(\)\s*\{.*\}\s*;\s*:",            # fork bomb
    r"\brm\s+(-[a-zA-Z]*\s+)*/\s*$",       # rm -rf /
    r"\brm\s+(-[a-zA-Z]*\s+)*/(etc|bin|usr|boot|var|root)\b",
    r"\bchown\s+-R\s+\S+\s+/\s*$",
    r"\bcurl\b[^|]*\|\s*(ba)?sh",          # pipe-to-shell
    r"\bwget\b[^|]*\|\s*(ba)?sh",
]

# Destructive but legitimate in a dev sandbox — ask first.
CONFIRM_PATTERNS = [
    r"\brm\b",
    r"\bsudo\b",
    r"\bkill(all)?\b",
    r"\bpkill\b",
    r"\bmv\b",
    r"\bchmod\b",
    r"\bchown\b",
    r"\btruncate\b",
    r"\bdropdb\b",
    r"\bgit\s+(reset|clean|push\s+--force|push\s+-f)\b",
    r"\bsupervisorctl\s+(stop|restart)\b",
    r"\bmongo(sh)?\b.*drop",
    r"\byarn\s+remove\b",
    r"\bpip\s+uninstall\b",
    r">\s*/",                              # redirect overwriting an absolute path
]

REASON_BLOCKED = "Bu komut geri alınamaz sistem hasarı verebilir; JARVIS güvenlik katmanı reddetti."
REASON_CONFIRM = "Bu komut yıkıcı olabilir. Çalıştırmam için onayını bekliyorum."


def classify(command: str) -> tuple[str, str | None]:
    """Return (verdict, reason) where verdict is safe | confirm | blocked."""
    cmd = command.strip()
    if not cmd:
        return "blocked", "Boş komut."
    low = cmd.lower()
    for pat in BLOCKED_PATTERNS:
        if re.search(pat, low):
            return "blocked", REASON_BLOCKED
    for pat in CONFIRM_PATTERNS:
        if re.search(pat, low):
            return "confirm", REASON_CONFIRM
    return "safe", None


async def run_command(command: str, confirm: bool = False) -> dict:
    """Execute a shell command under the sandbox policy. Never raises."""
    verdict, reason = classify(command)
    if verdict == "blocked":
        return {
            "command": command, "stdout": "", "stderr": reason or "", "exit_code": 126,
            "blocked": True, "needs_confirm": False, "reason": reason,
        }
    if verdict == "confirm" and not confirm:
        return {
            "command": command, "stdout": "", "stderr": "", "exit_code": 0,
            "blocked": False, "needs_confirm": True, "reason": reason,
        }

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=WORKDIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT_SEC)
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "command": command, "stdout": "", "stderr": f"Komut {TIMEOUT_SEC}s içinde bitmedi, iptal ettim.",
                "exit_code": 124, "blocked": False, "needs_confirm": False, "reason": "timeout",
            }
        return {
            "command": command,
            "stdout": out.decode("utf-8", "replace")[:MAX_OUTPUT],
            "stderr": err.decode("utf-8", "replace")[:MAX_OUTPUT],
            "exit_code": proc.returncode if proc.returncode is not None else 0,
            "blocked": False, "needs_confirm": False, "reason": None,
        }
    except Exception as exc:  # a failed spawn is a result, not a 500
        return {
            "command": command, "stdout": "", "stderr": f"Komut başlatılamadı: {exc}",
            "exit_code": 1, "blocked": False, "needs_confirm": False, "reason": "spawn_error",
        }


async def scan_workspace(path: str = WORKDIR) -> dict:
    """Real project telemetry: git branch, last commits, dirty files, tracked dirs."""
    safe_path = shlex.quote(path)
    script = (
        f"cd {safe_path} 2>/dev/null || exit 1; "
        "echo '##BRANCH'; git rev-parse --abbrev-ref HEAD 2>/dev/null; "
        "echo '##COMMITS'; git log --pretty=format:'%h|%ar|%s' -n 8 2>/dev/null; "
        "echo '##DIRTY'; git status --porcelain 2>/dev/null | head -20; "
        "echo '##TREE'; ls -1 2>/dev/null | head -25"
    )
    res = await run_command(script, confirm=True)
    raw = res["stdout"]
    sections: dict[str, list[str]] = {}
    current = ""
    for line in raw.splitlines():
        if line.startswith("##"):
            current = line[2:].lower()
            sections[current] = []
        elif current:
            sections[current].append(line)
    commits = []
    for line in sections.get("commits", []):
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({"hash": parts[0], "when": parts[1], "subject": parts[2]})
    return {
        "path": path,
        "branch": (sections.get("branch") or [""])[0],
        "commits": commits,
        "dirty": [d for d in sections.get("dirty", []) if d.strip()],
        "tree": [t for t in sections.get("tree", []) if t.strip()],
    }
