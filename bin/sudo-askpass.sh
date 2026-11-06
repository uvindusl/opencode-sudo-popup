#!/bin/bash
# SUDO_ASKPASS helper for opencode-sudo-popup — compact popup.
# Contract: print password to stdout on OK, exit non-zero on Cancel.
# Reads context from the per-user reason file (JSON from src/index.js or the
# wrapper, backward-compatible with legacy flat-string files).

REASON_FILE="/tmp/opencode-sudo-popup-$(id -u)/reason.json"
export OPENCODE_SUDO_REASON="$REASON_FILE"

# --- Backend: modern compact dialog via GJS + GTK4/libadwaita -----------------
# Prints password to stdout on OK, exit 1 on Cancel — same askpass contract.
GJS_DIALOG="$(dirname "$0")/sudo-askpass-gjs.js"
if command -v gjs >/dev/null 2>&1 && [[ -f "$GJS_DIALOG" ]]; then
  exec gjs "$GJS_DIALOG" 2>/dev/null
fi

# --- No GJS available ---------------------------------------------------------
echo "opencode-sudo-popup: gjs + GTK4/libadwaita not found; cannot show the sudo popup." >&2
echo "Install gjs and libadwaita (e.g. apt install gjs gir1.2-gtk-4.0 libadwaita-1-0)." >&2
exit 1
