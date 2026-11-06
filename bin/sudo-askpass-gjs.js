#!/usr/bin/env gjs
// opencode-sudo-popup — minimal askpass dialog (GJS + GTK4 + libadwaita).
// Compact: shows the command opencode is about to run + a password field.
// Contract: prints password to stdout on OK, exit 1 on Cancel.
// Reads context from the per-user reason file (JSON or legacy flat string).
// The path is provided by sudo-askpass.sh via OPENCODE_SUDO_REASON.

imports.gi.versions.Gtk = "4.0";
imports.gi.versions.Adw = "1";
const { Gtk, Gio, Adw, GLib } = imports.gi;

const REASON = GLib.getenv("OPENCODE_SUDO_REASON") || "";
const TITLE = "Sudo required";

function readCommand() {
  try {
    const file = Gio.File.new_for_path(REASON);
    if (!file.query_exists(null)) return "";
    const [, content] = file.load_contents(null);
    const raw = new TextDecoder().decode(content).trim();
    if (raw.startsWith("{")) {
      try {
        return oneLine(JSON.parse(raw).command || "").slice(0, 300);
      } catch {
        // fall through
      }
    }
    return oneLine(raw).slice(0, 300);
  } catch {
    return "";
  }
}

function oneLine(t) {
  return String(t).replace(/\s+/g, " ").trim();
}

// ---------- build UI ----------
Adw.init();

const command = readCommand();
const display = command || "sudo <unknown command>";

const app = new Gtk.Application();
let finished = false;

app.connect("activate", () => {
  const win = new Adw.Window({
    application: app,
    title: TITLE,
    modal: true,
    resizable: false,
    default_width: 420,
  });
  win.set_icon_name("dialog-password");

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    margin_top: 16,
    margin_bottom: 16,
    margin_start: 16,
    margin_end: 16,
  });
  win.set_content(content);

  // command label — what opencode is about to run, monospace + wrapped
  const cmdLbl = new Gtk.Label({
    label: display,
    wrap: true,
    xalign: 0,
    selectable: true,
    max_width_chars: 48,
  });
  cmdLbl.add_css_class("monospace");
  cmdLbl.add_css_class("body");
  content.append(cmdLbl);

  const pwRow = new Adw.PasswordEntryRow();
  pwRow.set_title("Password");
  pwRow.set_activates_default(true);
  content.append(pwRow);

  const finish = (pw) => {
    if (finished) return;
    finished = true;
    if (pw) print(pw);
    win.close();
  };

  const actionBar = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    halign: Gtk.Align.END,
  });
  content.append(actionBar);

  const cancelBtn = new Gtk.Button({ label: "Cancel" });
  cancelBtn.connect("clicked", () => finish(""));
  actionBar.append(cancelBtn);

  const okBtn = new Gtk.Button({ label: "Authenticate" });
  okBtn.add_css_class("suggested-action");
  okBtn.connect("clicked", () => finish(pwRow.get_text()));
  actionBar.append(okBtn);
  win.set_default_widget(okBtn);

  pwRow.connect("activate", () => finish(pwRow.get_text()));
  pwRow.grab_focus();

  win.present();
});

app.run(null);
imports.system.exit(finished ? 0 : 1);