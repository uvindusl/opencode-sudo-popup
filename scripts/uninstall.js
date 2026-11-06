import { readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const HOME = homedir()
const CONFIG_DIR = join(HOME, ".config", "opencode")
const RCS = [
  join(HOME, ".zshenv"),
  join(HOME, ".bashrc"),
  join(HOME, ".config", "fish", "config.fish"),
]

const FILES = [
  join(HOME, ".local", "bin", "sudo"), // wrapper (only if it is ours)
  join(CONFIG_DIR, "plugin", "sudo-reason.js"),
  join(CONFIG_DIR, "plugins", "sudo-reason.js"),
  join(CONFIG_DIR, "sudo-askpass.sh"),
  join(CONFIG_DIR, "sudo-askpass-gjs.js"),
]

const MARKER = "# added by opencode-sudo-popup"
// Lines this installer may have added.
const OUR_LINE = /^\s*(export PATH=.*\.local\/bin|export SUDO_ASKPASS=|set -gx PATH .*\.local\/bin|set -gx SUDO_ASKPASS )/

async function stripRc(rc) {
  if (!existsSync(rc)) return false
  const cur = await readFile(rc, "utf8")
  if (!cur.includes(MARKER)) return false

  const lines = cur.split("\n")
  const out = []
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === MARKER) {
      changed = true
      // Drop the marker and the lines that immediately follow it.
      let j = i + 1
      while (j < lines.length) {
        if (OUR_LINE.test(lines[j]) || lines[j].trim() === "") {
          if (lines[j].trim() === "" && !(j + 1 < lines.length && OUR_LINE.test(lines[j + 1]))) break
          j++
          continue
        }
        break
      }
      i = j - 1
      continue
    }
    out.push(lines[i])
  }
  if (changed) await writeFile(rc, out.join("\n").replace(/\n{3,}/g, "\n\n"))
  return changed
}

async function removeFile(path, expectMarker) {
  if (!existsSync(path)) return false
  if (expectMarker) {
    const content = await readFile(path, "utf8")
    // Never delete an unrelated `sudo` binary that is not our wrapper.
    if (!content.includes("opencode-sudo-popup")) return false
  }
  await rm(path, { force: true })
  return true
}

async function main() {
  let removed = 0
  for (const file of FILES) {
    if (await removeFile(file, file.endsWith("/sudo"))) {
      console.log(`[opencode-sudo-popup] removed ${file}`)
      removed++
    }
  }
  for (const rc of RCS) {
    if (await stripRc(rc)) {
      console.log(`[opencode-sudo-popup] cleaned ${rc}`)
      removed++
    }
  }
  // Ephemeral reason files live under /tmp and are recreated on demand.
  await rm(join("/tmp", `opencode-sudo-popup-${typeof process.getuid === "function" ? process.getuid() : ""}`), {
    recursive: true,
    force: true,
  })
  console.log(removed ? "[opencode-sudo-popup] uninstalled. Restart opencode." : "[opencode-sudo-popup] nothing to remove.")
}

main().catch((e) => {
  console.error("[opencode-sudo-popup] uninstall warning:", e.message)
})
