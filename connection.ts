import { Client, type ConnectConfig } from "ssh2";
import { readFileSync } from "node:fs";
import { makeReadySentinel, makeStartSentinel, makeEndSentinel, stripAnsi } from "./utils.js";
import type { SshProfile, CommandResult } from "./types.js";

export class SshConnection {
  private client: Client | null = null;
  private shell: NodeJS.ReadWriteStream | null = null;
  private outputBuffer = "";
  private busy = false;
  private queue: Array<() => void> = [];
  private profile: SshProfile | null = null;
  private _reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3;

  constructor(
    private onOutput: (text: string) => void,
    private onExitCode?: (code: number) => void
  ) {}

  async connect(profile: SshProfile): Promise<void> {
    this.profile = profile; // Store for reconnect
    this._reconnectAttempts = 0;
    return this._connect(profile);
  }

  private async _connect(profile: SshProfile): Promise<void> {
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
              this.onOutput(t);
              if (!resolved && this.outputBuffer.includes(readySentinel)) {
                clearTimeout(handshakeTimer);
                finish();
              }
            });
            // Send sentinel FIRST to confirm shell is alive, then best-effort stty setup.
            // Use echo with printable sentinels — control chars get corrupted by PTY line discipline.
            const initCmd = [
              `echo ${readySentinel}`,
              "export TERM=xterm-256color",
              "stty -echo 2>/dev/null",
              "stty cols 1000 rows 50 2>/dev/null",
              // Termux: ensure standard tools are on PATH
              "export PATH=$PATH:${PREFIX}/bin 2>/dev/null || true",
            ].join("; ");
            this.shell.write(`${initCmd}\n`);
          });
        })
        .on("error", (err) => finish(err))
        .connect(config);

      // Timeout: if the shell never sends the sentinel, reject
      const handshakeTimer = setTimeout(() => {
        finish(new Error("Shell handshake timed out after 15s"));
      }, 15000);
    });
  }

  private async reconnect(): Promise<void> {
    if (!this.profile || this._reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error("Max reconnect attempts reached");
    }
    this._reconnectAttempts++;
    const delay = this._reconnectAttempts * 1000; // 1s, 2s, 3s backoff
    await new Promise(r => setTimeout(r, delay));
    await this._connect(this.profile!);
  }

  async exec(cmd: string, timeout = 30000): Promise<CommandResult> {
    if (!this.shell) {
      try {
        await this.reconnect();
      } catch {
        throw new Error("Connection closed and reconnect failed");
      }
    }
    if (this.busy)
      return new Promise<CommandResult>((resolve, reject) =>
        this.queue.push(() => this.exec(cmd, timeout).then(resolve, reject)),
      );

    this.busy = true;
    const id = Date.now();
    const startSentinel = makeStartSentinel(id);
    const endSentinel = makeEndSentinel(id);
    // echo with printable sentinels; capture exit code: END_<id>__<code>
    const wrapped = `echo ${startSentinel}; ${cmd}; echo ${endSentinel}$?\n`;

    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          this.shell?.write("\x03"); // Interrupt hung process
          this.shell?.removeListener("data", handler);
        } finally {
          this.busy = false;
          this.next();
          reject(new Error("Command timed out"));
        }
      }, timeout);

      const handler = () => {
        // Prevent unbounded growth if a command produces massive output
        if (this.outputBuffer.length > 10_000_000) {
          clearTimeout(timer);
          this.shell?.removeListener("data", handler);
          this.busy = false;
          this.next();
          reject(new Error("Output exceeded 10MB limit"));
          return;
        }
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
          this.onExitCode?.(code);
          resolve({
            stdout: stripAnsi(out).trim(),
            stderr: code !== 0 ? `Process exited with code ${code}` : "",
            exitCode: isNaN(code) ? -1 : code,
          });
        } else {
          resolve({ stdout: "", stderr: "Failed to parse output", exitCode: -1 });
        }
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

  get reconnectAttempts() {
    return this._reconnectAttempts;
  }

  getStatus(): "connected" | "disconnected" | "reconnecting" {
    if (this.shell) return "connected";
    if (this._reconnectAttempts > 0) return "reconnecting";
    return "disconnected";
  }
}
