#!/usr/bin/env bash
# opencode-sudo-popup — sudo wrapper.
#
# Intercepts `sudo` invocations so the desktop popup can show *which*
# command needs root before asking for the password — but only when the
# call comes from OpenCode.
#
# Behaviour:
#   - Not launched by OpenCode: exec real sudo unchanged. Your normal
#     terminal, scripts, cron and services are never affected.
#   - OpenCode, interactive terminal: exec real sudo unchanged.
#   - OpenCode, non-interactive (the bash tool): leave a fresh reason file
#     written by the plugin alone, otherwise record this command in a
#     user-private directory, then exec real sudo with -A (askpass) so the
#     dialog appears.
#
# Safety:
#   - The real sudo is resolved from PATH with this wrapper's own directory
#     skipped, so it never recurses into itself and is not hardcoded.
#   - The reason file lives in a per-user 0700 directory under /tmp and is
#     written atomically with mode 0600. It is never a fixed, predictable
#     file that another user could pre-create or symlink.

set -u

uid="$(id -u)"
REASON_DIR="/tmp/opencode-sudo-popup-${uid}"
REASON_FILE="${REASON_DIR}/reason.json"

self_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

resolve_real_sudo() {
  if [ -n "${OPENCODE_SUDO_REAL:-}" ] && [ -x "${OPENCODE_SUDO_REAL}" ]; then
    printf '%s' "${OPENCODE_SUDO_REAL}"
    return
  fi
  local d
  local -a dirs
  IFS=: read -r -a dirs <<< "${PATH:-/usr/local/bin:/usr/bin:/bin}"
  for d in "${dirs[@]}"; do
    [ -n "$d" ] || continue
    [ "$d" = "$self_dir" ] && continue
    if [ -x "$d/sudo" ] && [ ! -d "$d/sudo" ]; then
      printf '%s' "$d/sudo"
      return
    fi
  done
  printf '%s' /usr/bin/sudo
}

REAL_SUDO="$(resolve_real_sudo)"

# Only interfere when OpenCode launched us and there is no terminal.
if [ -z "${OPENCODE:-}" ] || [ -t 0 ]; then
  exec "$REAL_SUDO" "$@"
fi

# Keep the plugin's richer JSON (which includes the inferred "purpose") when
# it was written for this command; only fall back to a flat string otherwise.
fresh=0
if [ -f "$REASON_FILE" ]; then
  mtime="$(stat -c %Y "$REASON_FILE" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  if [ "$mtime" -gt "$((now - 120))" ] 2>/dev/null; then
    fresh=1
  fi
fi

if [ "$fresh" -eq 0 ]; then
  if mkdir -p "$REASON_DIR" 2>/dev/null &&
    [ ! -L "$REASON_DIR" ] &&
    [ -d "$REASON_DIR" ] &&
    [ "$(stat -c %u "$REASON_DIR" 2>/dev/null || echo -1)" = "$uid" ]; then
    chmod 700 "$REASON_DIR" 2>/dev/null || true
    tmp="$(mktemp "${REASON_DIR}/.reason.XXXXXX" 2>/dev/null || true)"
    if [ -n "$tmp" ]; then
      umask 077
      if printf 'sudo %s\n' "$*" >"$tmp" 2>/dev/null; then
        mv -f "$tmp" "$REASON_FILE" 2>/dev/null && chmod 600 "$REASON_FILE" 2>/dev/null || rm -f "$tmp"
      else
        rm -f "$tmp"
      fi
    fi
  fi
fi

# OpenCode's shell may not source the user's rc files, so default the helper.
: "${SUDO_ASKPASS:=$HOME/.config/opencode/sudo-askpass.sh}"
export SUDO_ASKPASS

exec "$REAL_SUDO" -A "$@"
