import { SshConnection } from "./connection.js";
import { TerminalWindow } from "./terminal-window.js";
import { detectSystem } from "./system-detect.js";
import type { SshProfile, SystemInfo } from "./types.js";

export class SshSession {
  public conn: SshConnection | null = null;
  public window: TerminalWindow | null = null;
  public system: SystemInfo | null = null;

  async connect(p: SshProfile) {
    this.window = new TerminalWindow();
    this.window.open(`SSH: ${p.username}@${p.host}`);
    this.conn = new SshConnection(this.window);
    await this.conn.connect(p);
    this.system = await detectSystem(this.conn);
  }

  disconnect() {
    this.conn?.disconnect();
    this.window?.close();
    this.conn = null;
    this.system = null;
  }
}
