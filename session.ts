import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SshConnection } from "./connection.js";
import { UiManager } from "./ui-manager.js";
import { detectSystem } from "./system-detect.js";
import type { SshProfile, SystemInfo } from "./types.js";

export class SshSession {
  public conn: SshConnection | null = null;
  public ui: UiManager = new UiManager();
  public system: SystemInfo | null = null;

  async connect(p: SshProfile, ctx: ExtensionContext) {
    this.ui.updateContext(ctx);
    this.conn = new SshConnection(
      (text) => this.ui.onOutput(text),
      (code) => this.ui.onExitCode(code)
    );
    await this.conn.connect(p);

    // Detection is best-effort — a failed probe must never abort the connection
    try {
      this.system = await detectSystem(this.conn);
    } catch (err) {
      console.warn("[pi-ssh-link] System detection failed, using defaults:", err);
      this.system = {
        os:             "unknown",
        packageManager: "unknown",
        arch:           "unknown",
        user:           "unknown",
        hasSudo:        false,
        shell:          "unknown",
        isContainer:    false,
        isTermux:       false,
        raw:            { uname: "", osRelease: "" },
      };
    }

    this.ui.onConnect(p);
  }

  disconnect() {
    this.conn?.disconnect();
    this.conn = null;
    this.system = null;
    this.ui.onDisconnect();
  }
}
