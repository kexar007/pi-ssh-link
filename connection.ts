import { Client, type ConnectConfig } from "ssh2";
import { readFileSync } from "node:fs";
import { makeReadySentinel, makeStartSentinel, makeEndSentinel, stripAnsi } from "./utils.js";
import type { SshProfile, CommandResult } from "./types.js";
import type { TerminalWindow } from "./terminal-window.js";

export class SshConnection {
  private client: Client | null = null;
  private shell: NodeJS.ReadWriteStream | null = null;
  private outputBuffer = "";
  private busy = false;
  private queue: Array<() => void> = [];

  constructor(private window: TerminalWindow) {}

  async connect(profile: SshProfile): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new Client();
      const config: ConnectConfig = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        readyTimeout: 15000,
      };
      if (profile.password) config.password = profile.password;
      else if (profile.privateKeyPath) config.privateKey = readFileSync(profile.privateKeyPath);
      else
        config.agent =
          process.env.SSH_AUTH_SOCK ||
          (process.platform === "win32" ? "\\\\.\\pipe\\openssh-ssh-agent" : undefined);

      let resolved = false;
      const readySentinel = makeReadySentinel();

      const finish = (err?: Error) => {
        if (resolved) return;
        resolved = true;
        clearInterval(checkReady);
        clearTimeout(handshakeTimer);
        if (err) reject(err);
        else {
          this.outputBuffer = "";
          resolve();
        }
      };

      this.client
        .on("ready", () => {
          this.client!.shell({ term: "xterm-256color" }, (err, stream) => {
            if (err) return finish(err);
            this.shell = stream;
            this.shell.on("data", (d: Buffer) => {
              const t = d.toString("utf8");
              this.outputBuffer += t;
              this.window.write(t);
            });
            // Send sentinel FIRST to confirm shell is alive, then best-effort stty setup.
            // Use echo with printable sentinels — control chars get corrupted by PTY line discipline.
            this.shell.write(
              `echo ${readySentinel}; stty -echo 2>/dev/null; stty cols 1000 2>/dev/null\n`,
            );
          });
        })
        .on("error", (err) => finish(err))
        .connect(config);

      // Poll for READY sentinel (printable string, survives PTY)
      const checkReady = setInterval(() => {
        if (this.outputBuffer.includes(readySentinel)) {
          finish();
        }
      }, 50);

      // Timeout: if the shell never sends the sentinel, reject
      const handshakeTimer = setTimeout(() => {
        finish(new Error("Shell handshake timed out after 15s"));
      }, 15000);
    });
  }

  async exec(cmd: string, timeout = 30000): Promise<CommandResult> {
    if (!this.shell) throw new Error("Connection closed");
    if (this.busy)
      return new Promise<CommandResult>((r) =>
        this.queue.push(() => this.exec(cmd, timeout).then(r)),
      );

    this.busy = true;
    const id = Date.now();
    const startSentinel = makeStartSentinel(id);
    const endSentinel = makeEndSentinel(id);
    // echo with printable sentinels; capture exit code: END_<id>__<code>
    const wrapped = `echo ${startSentinel}; ${cmd}; echo ${endSentinel}$?\n`;

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.shell?.write("\x03"); // Interrupt hung process
        this.shell?.removeListener("data", handler);
        this.busy = false;
        reject(new Error("Timeout"));
        this.next();
      }, timeout);

      const handler = () => {
        const endIdx = this.outputBuffer.indexOf(endSentinel);
        if (endIdx === -1) return;
        clearTimeout(timer);
        this.shell?.removeListener("data", handler);

        const startIdx = this.outputBuffer.indexOf(startSentinel);
        if (startIdx !== -1) {
          // Extract output between start and end sentinels
          const out = this.outputBuffer.slice(startIdx + startSentinel.length, endIdx);
          // Parse exit code from text after end sentinel
          const afterEnd = this.outputBuffer.slice(endIdx + endSentinel.length);
          const codeMatch = afterEnd.match(/^(\d+)/);
          const code = codeMatch ? parseInt(codeMatch[1], 10) : -1;
          resolve({
            stdout: stripAnsi(out).trim(),
            stderr: "",
            exitCode: isNaN(code) ? -1 : code,
          });
        } else {
          resolve({ stdout: "", stderr: "Failed to parse output", exitCode: -1 });
        }
        this.outputBuffer = "";
        this.busy = false;
        this.next();
      };
      this.outputBuffer = "";
      this.shell!.on("data", handler);
      this.shell!.write(wrapped);
    });
  }

  private next() {
    const n = this.queue.shift();
    if (n) n();
  }

  disconnect() {
    this.shell?.end();
    this.client?.end();
    this.shell = null;
  }

  get isConnected() {
    return !!this.shell;
  }
}
