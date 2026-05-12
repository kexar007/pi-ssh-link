import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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

    // Mount the panel with "connecting" state BEFORE connection,
    // so output streams into the already-visible panel.
    this.ui.setConnecting(p);

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

    // Transition from "connecting" to "connected" (no buffer clear)
    this.ui.onConnect(p);
    // Push system info to panel for the header badge
    this.ui.setSystemInfo(this.system);
  }

  disconnect() {
    this.conn?.disconnect();
    this.conn = null;
    this.system = null;
    this.ui.onDisconnect();
  }
}
