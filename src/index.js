import { writeFile, mkdir, rename, rm, stat } from "node:fs/promises"

// Where the askpass helper (installed by the postinstall script) lives.
// SUDO_ASKPASS points here; this plugin only needs to know the shared
// reason-file path to communicate with it. Keep this in sync with
// bin/sudo-askpass.sh and bin/sudo-wrapper.sh.
const UID = typeof process.getuid === "function" ? process.getuid() : "unknown"
const REASON_DIR = `/tmp/opencode-sudo-popup-${UID}`
const REASON_FILE = `${REASON_DIR}/reason.json`

// A sudo invocation can be disguised as other words (e.g. the string
// "sudo" inside a path, a comment, or a variable named "sudo"). Only
// treat it as real when "sudo" appears as a whole word at a command
// boundary (start of line, after ; || &&, a pipe, or whitespace).
const SUDO_RE = /(^|[;&|(\s]+)sudo(\s+[a-zA-Z\-./~]|$)/

// sudo option flags that consume an argument we should skip when trying
// to find the actual command being run.
const FLAG_WITH_ARG = new Set(["-C", "-D", "-h", "-p", "-u", "-U", "-g", "-T"])

function containsSudo(cmd) {
  if (!SUDO_RE.test(cmd)) return false
  // Ignore sudo occurrences inside comments: strip everything from an
  // unquoted # to end of line before re-checking.
  const withoutComment = cmd.replace(/(^|[^\\])#.*$/, "$1")
  return SUDO_RE.test(withoutComment)
}

// Find the actual sudo sub-command within a possibly multi-command line,
// so the popup shows something like "sudo apt update" rather than the
// full "echo hi | sudo tee /etc/x" incantation. Falls back to the whole
// line if sudo's target can't be isolated.
function sudoTarget(cmd) {
  // Split on shell separators and pick the segment(s) that contain sudo.
  const segments = cmd.split(/[;&|]+/).map((s) => s.trim()).filter(Boolean)
  const sudoSegs = segments.filter((s) => containsSudo(s))
  const target = sudoSegs.join(" && ") || segments[0] || cmd

  // Strip leading "sudo" and its option flags to reveal the real command.
  const tokens = target.trim().split(/\s+/)
  let i = 0
  if (tokens[i]?.toLowerCase() === "sudo") i++
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "--") break
    if (t.startsWith("-") && t.length > 1) {
      // flag with inline arg like -u root stays as one token; else skip next
      if (FLAG_WITH_ARG.has(t) || FLAG_WITH_ARG.has(t.slice(0, 2))) i++
      i++
      continue
    }
    break
  }
  const rest = tokens.slice(i).join(" ")
  return rest ? `sudo ${rest}` : cmd
}

// --- Why inference (offline heuristics, zero deps) --------------------------
// Returns a single plain-language sentence describing WHAT the command does.
// Only uses tokens/paths actually present in the command — never invents
// user intent. Unknown commands fall through to the generic line.
function shortList(items, max = 3) {
  const clean = items.filter(Boolean).slice(0, 20)
  if (clean.length <= max) return clean.join(", ")
  return `${clean.slice(0, max).join(", ")} +${clean.length - max} more`
}

function pkgsAfter(tokens, verb) {
  const idx = tokens.findIndex((t) => t === verb)
  if (idx < 0) return []
  return tokens
    .slice(idx + 1)
    .filter((t) => t && !t.startsWith("-") && t !== "&&" && !/^[;&|]+$/.test(t))
    .map((t) => t.replace(/^["']|["']$/g, "").replace(/[,;]+$/, ""))
    .filter(Boolean)
}

function findSysPath(cmd) {
  const m = cmd.match(/(^|[\s"'=])(\/(etc|usr|opt|var|srv)(\/\S*)?)/)
  if (!m) return ""
  return m[2].replace(/["'`,;:]+$/, "").slice(0, 80)
}

function inferPurpose(target, fullCmd = "") {
  const cmd = target
    .replace(/^sudo\s+/, "")
    .replace(/^\/(usr\/bin|bin|usr\/sbin|sbin)\//, "")
    .trim()
  const low = ` ${cmd} `.toLowerCase().slice(0, 500)

  // sudo -u somebody (not full root) — surface it so the warning stays honest.
  const runAs = (fullCmd || target).match(/sudo\s+(?:-[a-zA-Z]*u\s+(\S+)|--user[=\s]+(\S+))/)
  const asUser = runAs?.[1]?.replace(/["']/g, "") ?? runAs?.[2]?.replace(/["']/g, "") ?? ""
  const prefix =
    asUser && !/^(root|0)$/.test(asUser) ? `Running as user “${asUser.slice(0, 32)}”: ` : ""
  const withPrefix = (s) => `${prefix}${s}`.slice(0, 240)

  // apt / apt-get
  if (/^(apt-get|apt)\s+update\b/.test(cmd))
    return withPrefix("Refreshing the system package list (nothing is installed or removed).")
  if (/^(apt-get|apt)\s+(upgrade|full-upgrade|dist-upgrade)\b/.test(cmd))
    return withPrefix("Upgrading installed system packages to newer versions.")
  {
    const m = cmd.match(/^(apt-get|apt)\s+(install|remove|purge|autoremove)\b/)
    if (m) {
      const pkgs = pkgsAfter(cmd.split(/\s+/), m[2])
      const verb = m[2] === "install" ? "Installing" : "Removing"
      if (!pkgs.length) return withPrefix(`${verb} system software.`)
      return withPrefix(`${verb} the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs)}”.`)
    }
  }
  // dnf / yum / zypper / apk / pacman / snap
  {
    const m = cmd.match(/^(dnf|yum|zypper)\s+(install|remove)\b/)
    if (m) {
      const pkgs = pkgsAfter(cmd.split(/\s+/), m[2])
      return withPrefix(
        m[2] === "install"
          ? `Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`
          : `Removing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`,
      )
    }
  }
  if (/^apk\s+add\b/.test(cmd)) {
    const pkgs = pkgsAfter(cmd.split(/\s+/), "add")
    return withPrefix(`Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  if (/^pacman\b/.test(cmd)) {
    if (/\s-S\w*u/.test(` ${cmd}`) && !pkgsAfter(cmd.split(/\s+/), "-S").length)
      return withPrefix("Upgrading installed system packages to newer versions.")
    const pkgs = cmd.split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "pacman" && t !== "-S")
    if (/\s-S/.test(` ${cmd}`))
      return withPrefix(`Installing the system package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  if (/^snap\s+install\b/.test(cmd)) {
    const pkgs = pkgsAfter(cmd.split(/\s+/), "install")
    return withPrefix(`Installing the Snap package${pkgs.length > 1 ? "s" : ""} “${shortList(pkgs) || "unknown"}”.`)
  }
  // language package managers run with sudo = system-wide install
  if (/^(pip3?|npm|gem|cargo)\b/.test(cmd))
    return withPrefix("Installing software system-wide (affects all users).")

  // systemctl / service
  {
    const m = cmd.match(/^systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload)\s+([A-Za-z0-9@_:.-]+)/)
    if (m) {
      const verbMap = { start: "Starting", stop: "Stopping", restart: "Restarting", reload: "Reloading", enable: "Enabling", disable: "Disabling", "daemon-reload": "Reloading system service definitions" }
      return withPrefix(`${verbMap[m[1]]} the system service “${m[2].slice(0, 64)}”.`)
    }
    const s = cmd.match(/^service\s+([A-Za-z0-9@_.-]+)\s+(start|stop|restart|reload)/)
    if (s) return withPrefix(`Restarting the system service “${s[1].slice(0, 64)}”.`)
  }
  // writing a system file (tee or redirect caught from the full line)
  {
    const hay = `${cmd} ${fullCmd}`
    if (/\btee\b/.test(hay) || /=>?\s*\/(etc|usr|opt|var|srv)\//.test(hay) || />\s*\/(etc|usr)\//.test(fullCmd)) {
      const p = findSysPath(hay)
      if (p) return withPrefix(`Writing a system configuration file at “${p}”.`)
      return withPrefix("Writing a system configuration file (outside your home directory).")
    }
  }
  // permissions / ownership
  if (/^(chmod|chown)\b/.test(cmd)) {
    const p = findSysPath(cmd) || cmd.split(/\s+/).slice(-1)[0]?.slice(0, 80)
    const what = cmd.startsWith("chmod") ? "permissions" : "ownership"
    return withPrefix(`Changing ${what} of “${p}”.`)
  }
  // system dirs / file install
  if (/^mkdir\b/.test(cmd)) {
    const p = findSysPath(cmd)
    if (p) return withPrefix(`Creating a system directory at “${p}”.`)
  }
  if (/^(cp|mv|ln|install)\b/.test(cmd) && /\s\/(etc|usr|opt|var|srv)\//.test(` ${cmd}`)) {
    const p = findSysPath(cmd)
    return withPrefix(`Installing a file to “${p || "a system directory"}”.`)
  }
  if (/^make\s+install\b/.test(cmd)) return withPrefix("Installing compiled software system-wide (make install).")
  // docker = de facto root
  if (/^docker\b/.test(cmd))
    return withPrefix("Managing Docker containers or images (equivalent to root via the Docker socket).")
  // firewall / users / mounts
  if (/^(ufw|iptables|firewall-cmd)\b/.test(cmd)) return withPrefix("Changing firewall rules.")
  if (/^(useradd|usermod|userdel|groupadd|passwd|chsh)\b/.test(cmd))
    return withPrefix("Creating or modifying a system user or group.")
  if (/^(mount|umount)\b/.test(cmd)) return withPrefix("Mounting or unmounting a filesystem.")

  // Fallback — states only what is known, never guesses.
  return "Opencode requested root to run the command below. Only approve if you expected a privileged step."
}

async function writeReason(cmd) {
  const tmp = `${REASON_FILE}.${process.pid}.tmp`
  try {
    await mkdir(REASON_DIR, { recursive: true, mode: 0o700 })
    const info = await stat(REASON_DIR)
    if (!info.isDirectory() || (UID !== "unknown" && info.uid !== UID)) return
    const target = sudoTarget(cmd).replace(/\s+/g, " ").trim().slice(0, 800)
    const purpose = inferPurpose(target, cmd)
    const payload = JSON.stringify({ v: 1, command: target, purpose, ts: Math.floor(Date.now() / 1000) })
    await writeFile(tmp, payload, { mode: 0o600 })
    await rename(tmp, REASON_FILE)
  } catch {
    // Best effort — the popup still works with a generic title.
    try {
      await rm(tmp, { force: true })
    } catch {
      // ignore
    }
  }
}

// Never treat our own plumbing as a sudo request: commands that reference
// the reason file or the askpass helper (self-tests, setup, diagnostics)
// must not overwrite the very reason they are trying to inspect.
const SELF_RE = /opencode-sudo-reason|sudo-askpass/i

async function handleCommand(command) {
  const cmd = String(command ?? "")
  if (SELF_RE.test(cmd)) return
  if (!containsSudo(cmd)) return
  await writeReason(cmd)
}

// V2 is optional at load time: an OpenCode V2 host provides `@opencode/plugin`
// while legacy V1 provides `@opencode-ai/plugin`. Resolve lazily and fall back
// to an identity `define` so the same file also loads under V1.
let Plugin
try {
  ;({ Plugin } = await import("@opencode/plugin"))
} catch {
  Plugin = { define: (plugin) => plugin }
}

export default {
  // OpenCode V2: `setup` registers a tool hook on the V2 ctx domain API.
  ...Plugin.define({
    id: "opencode-sudo-popup",
    async setup(ctx) {
      const registration = await ctx.tool.hook("execute.before", async (event) => {
        if (event.tool !== "bash") return
        const input = event.input
        const command = input && typeof input === "object" ? input.command : undefined
        await handleCommand(command)
      })
      return () => registration.dispose()
    },
  }),
  // OpenCode V1 (legacy): V1 calls `server()` and uses the returned hooks.
  async server() {
    return {
      "tool.execute.before": async (input, output) => {
        if (input.tool !== "bash") return
        await handleCommand(output.args?.command)
      },
    }
  },
}
