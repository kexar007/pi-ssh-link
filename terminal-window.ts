import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync, rmSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class TerminalWindow {
  private logPath: string;
  private scriptPath: string;
  private logStream: WriteStream | null = null;

  constructor() {
    const id = `ssh-${Date.now()}`;
    this.logPath = join(tmpdir(), `${id}.log`);
    this.scriptPath = join(tmpdir(), `${id}.ps1`);
  }

  open(title: string) {
    writeFileSync(this.logPath, "");
    this.logStream = createWriteStream(this.logPath, { flags: "a" });
    const ps = `$Host.UI.RawUI.WindowTitle = '${title}'; Get-Content -Wait '${this.logPath}' -Tail 50`;
    writeFileSync(this.scriptPath, ps);

    const cmd = `powershell -ExecutionPolicy Bypass -File "${this.scriptPath}"`;
    try {
      spawn("wt.exe", ["--title", title, "cmd", "/k", cmd], { detached: true });
    } catch {
      spawn("cmd.exe", ["/c", `start "${title}" ${cmd}`], { detached: true });
    }
  }

  write(d: string) {
    this.logStream?.write(d);
  }

  close() {
    this.logStream?.end();
    setTimeout(() => {
      try {
        rmSync(this.logPath);
        rmSync(this.scriptPath);
      } catch {
        // Ignore cleanup errors
      }
    }, 1000);
  }
}
