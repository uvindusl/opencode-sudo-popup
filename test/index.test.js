import { test } from "node:test"
import assert from "node:assert"
import { containsSudo, sudoTarget, inferPurpose, default as plugin } from "../src/index.js"

test("loads the plugin module", () => {
  assert.ok(plugin)
  assert.ok(typeof plugin.setup === "function")
  assert.ok(typeof plugin.server === "function")
})

// --- containsSudo ------------------------------------------------------------
test("containsSudo matches whole-word sudo at command start", () => {
  assert.ok(containsSudo("sudo apt update"))
})

test("containsSudo matches sudo after shell separators", () => {
  assert.ok(containsSudo("echo hi && sudo rm -rf /"))
  assert.ok(containsSudo("echo hi | sudo tee /etc/x"))
  assert.ok(containsSudo("cmd1; sudo cmd2"))
})

test("containsSudo matches sudo with flags", () => {
  assert.ok(containsSudo("sudo -u root apt update"))
  assert.ok(containsSudo("sudo --user nobody apt update"))
})

test("containsSudo does not match sudo in a variable or path", () => {
  assert.ok(!containsSudo("PATH=/usr/bin/sudo:/bin"))
  assert.ok(!containsSudo("my_sudo_cmd=sudo"))
  assert.ok(!containsSudo("./some/sudo/file"))
})

test("containsSudo does not match sudo in a comment", () => {
  assert.ok(!containsSudo("# run sudo apt update later"))
})

// --- sudoTarget --------------------------------------------------------------
test("sudoTarget keeps simple sudo command", () => {
  assert.equal(sudoTarget("sudo apt update"), "sudo apt update")
})

test("sudoTarget strips -u flag and user", () => {
  assert.equal(sudoTarget("sudo -u root apt update"), "sudo apt update")
})

test("sudoTarget strips --user flag and user (separate arg)", () => {
  assert.equal(sudoTarget("sudo --user root apt update"), "sudo apt update")
})

test("sudoTarget strips --user=root (inline arg)", () => {
  assert.equal(sudoTarget("sudo --user=root apt update"), "sudo apt update")
})

test("sudoTarget strips -p flag", () => {
  assert.equal(sudoTarget("sudo -p mypass apt update"), "sudo apt update")
})

test("sudoTarget stops consuming flags at -- separator", () => {
  assert.equal(sudoTarget("sudo -- apt update"), "sudo -- apt update")
})

test("sudoTarget isolates sudo segment from a pipeline", () => {
  assert.equal(sudoTarget("echo hi | sudo tee /etc/x"), "sudo tee /etc/x")
})

test("sudoTarget joins multiple sudo segments", () => {
  assert.equal(sudoTarget("sudo apt update && sudo apt upgrade"), "sudo apt update && sudo apt upgrade")
})

test("sudoTarget falls back to whole line when target can't be isolated", () => {
  assert.equal(sudoTarget("sudo"), "sudo")
})

// --- inferPurpose ------------------------------------------------------------
test("inferPurpose describes apt update", () => {
  const purpose = inferPurpose("sudo apt update")
  assert.ok(purpose.includes("package list"))
})

test("inferPurpose describes apt upgrade", () => {
  const purpose = inferPurpose("sudo apt upgrade")
  assert.ok(purpose.includes("Upgrading"))
})

test("inferPurpose describes apt install with packages", () => {
  const purpose = inferPurpose("sudo apt install nginx curl")
  assert.ok(purpose.includes("Installing"))
  assert.ok(purpose.includes("nginx"))
  assert.ok(purpose.includes("curl"))
})

test("inferPurpose describes --user correctly", () => {
  const target = sudoTarget("sudo --user nobody apt update")
  const purpose = inferPurpose(target, "sudo --user nobody apt update")
  assert.ok(purpose.includes("Running as user"))
  assert.ok(purpose.includes("package list"))
})

test("inferPurpose describes systemctl restart", () => {
  const purpose = inferPurpose("sudo systemctl restart nginx")
  assert.ok(purpose.includes("Restarting"))
  assert.ok(purpose.includes("nginx"))
})

test("inferPurpose describes chmod on system path", () => {
  const purpose = inferPurpose("sudo chmod 755 /etc/sudoers")
  assert.ok(purpose.includes("permissions"))
})

test("inferPurpose generic fallback", () => {
  const purpose = inferPurpose("sudo some-unknown-cmd")
  assert.ok(purpose.includes("root"))
})

// --- setup hook --------------------------------------------------------------
test("setup registers execute.before hook and invokes it", async () => {
  const calls = []
  const registration = { dispose() {} }
  await plugin.setup({
    tool: {
      hook: async (_name, cb) => {
        await cb({ tool: "bash", input: { command: "sudo apt update" } })
        calls.push("hooked")
        return registration
      },
    },
  })
  assert.equal(calls.length, 1)
})

test("setup ignores non-bash tools (no reason file written)", async () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : "unknown"
  const reasonFile = `/tmp/opencode-sudo-popup-${uid}/reason.json`
  const { rm, stat } = await import("node:fs/promises")
  await rm(reasonFile, { force: true }).catch(() => {})

  await plugin.setup({
    tool: {
      hook: async (_name, cb) => {
        await cb({ tool: "file", input: { command: "sudo apt update" } })
        return { dispose() {} }
      },
    },
  })

  let exists = false
  try {
    await stat(reasonFile)
    exists = true
  } catch {
    exists = false
  }
  assert.ok(!exists)
})
