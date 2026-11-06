# opencode-sudo-popup

When opencode runs tasks with `sudo`, it often halts mid-work to ask you to run a privileged command manually. This plugin lets opencode request root itself through a native desktop popup — showing exactly which command is about to run — so your workflow isn't interrupted.

A minimal, compact window — just the command opencode is about to execute and a password field:

## Requirements

- Linux with `sudo`
- Display server (Wayland or X11)
- **Required:** GJS + GTK4 + libadwaita (native on GNOME) for the compact native dialog. Without `gjs` the popup cannot be shown.

## Install

Clone + install + restart opencode:

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
```

The `postinstall` script automatically:

- Copies the askpass helper + GJS dialog to `~/.config/opencode/`.
- Installs a `sudo` wrapper to `~/.local/bin/sudo`. It only changes behaviour when OpenCode launched the command (`OPENCODE` is set) and there is no terminal; everywhere else it simply `exec`s the real sudo.
- Installs the plugin itself to `~/.config/opencode/plugin/sudo-reason.js` (V1) and `~/.config/opencode/plugins/sudo-reason.js` (V2).
- Adds `PATH` and `SUDO_ASKPASS` exports to your shell rc file (`~/.zshenv`, `~/.bashrc`, or `~/.config/fish/config.fish`) — only when not already configured.

> Restart OpenCode (and your terminal) after installing.

> `~/.local/bin` must come before `/usr/bin` in `PATH` for the wrapper to be found. The wrapper is inert outside OpenCode, so it does not affect your normal `sudo`, scripts, cron jobs, or services.

> V2 note: the plugin is built for the OpenCode V2 plugin API (`@opencode/plugin`, `Plugin.define`) and keeps a V1 `server()` export. The wrapper is a fallback for V2 builds that do not call `setup()` for file-local plugins; when your build does load the plugin, the `execute.before` hook adds the richer "purpose" text to the dialog.

## Usage

Just use opencode normally. Any time it needs root, the compact dialog appears showing the command to be run. Type your password to allow it once, or Cancel to deny.

## Backend

The helper uses a native **GJS + GTK4 + libadwaita** dialog (`Adw.Window` with a `PasswordEntryRow` and monospace command label) — a tiny single-screen window. This is the only backend; it prints a clear error if `gjs` is unavailable.

The plugin writes JSON (`{command, purpose, ts}`) to a per-user file at `/tmp/opencode-sudo-popup-<uid>/reason.json` (directory `0700`, file `0600`); the GJS helper reads it with `Gio`, falling back to a flat command string written by the wrapper.

## What it catches

It only matches `sudo` used as an actual command (whole word at a command boundary) — so it won't false-positive on a file path like `./some/sudo/file` or a `#`-comment mentioning sudo. It also strips sudo flags (`-u`, `-p`, etc.) and shell separators so the dialog shows the *real* command that needs root (e.g. `sudo apt update`).

## Development

```bash
git clone https://github.com/uvindusl/opencode-sudo-popup
cd opencode-sudo-popup
npm install
# postinstall wires the askpass helper + sudo wrapper into ~/.config/opencode and ~/.local/bin.
# The plugin exports both:
#   - setup()   → OpenCode V2 tool hook (execute.before)
#   - server()  → OpenCode V1 legacy hooks
# To test the command-detection logic in isolation (V2 hook):
node --input-type=module -e "
import('./src/index.js').then(async m => {
  const p = m.default;
  await p.setup({ tool: { hook: async (name, cb) => { await cb({ tool: 'bash', input: { command: 'sudo apt update' } }); return { dispose() {} } } } });
});
"
cat /tmp/opencode-sudo-popup-$(id -u)/reason.json
# Or test the V1 server hook:
node --input-type=module -e "
import('./src/index.js').then(async m => {
  const p = m.default;
  const hooks = await p.server();
  await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'sudo apt update' } });
});
"
cat /tmp/opencode-sudo-popup-$(id -u)/reason.json
```

## Uninstall

```bash
npm run uninstall
```

Removes the `sudo` wrapper, the plugin copies, the askpass helpers, and the lines this installer added to your shell rc files. Restart OpenCode afterwards.

## License

MIT
