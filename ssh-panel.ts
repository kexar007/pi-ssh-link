import { truncateToWidth, matchesKey, Key } from "@mariozechner/pi-tui";
import type { SshProfile, SystemInfo } from "./types.js";
import { stripAnsi } from "./utils.js";

const MAX_BUFFER_LINES = 200;
const DEFAULT_VISIBLE_LINES = 10;

export class SshPanel {
  private buffer: string[] = [];
  private scrollOffset = 0;
  private connected = false;
  private connecting = false;
  private profile: SshProfile | null = null;
  private systemInfo: SystemInfo | null = null;
  private lastExitCode: number | null = null;
  private lastCommand: string | null = null;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private themeRef: any = null;

  // --- Public API ---

  write(text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      const cleaned = stripAnsi(line);
      if (cleaned.trim() !== "") {
        this.buffer.push(cleaned);
      }
    }
    if (this.buffer.length > MAX_BUFFER_LINES) {
      this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER_LINES);
    }
    this.invalidate();
  }

  setExitCode(code: number): void {
    this.lastExitCode = code;
    this.invalidate();
  }

  setLastCommand(cmd: string): void {
    this.lastCommand = cmd;
    this.invalidate();
  }

  setSystemInfo(info: SystemInfo): void {
    this.systemInfo = info;
    this.invalidate();
  }

  setConnecting(profile: SshProfile): void {
    this.connecting = true;
    this.connected = false;
    this.profile = profile;
    this.buffer = [];
    this.scrollOffset = 0;
    this.lastExitCode = null;
    this.lastCommand = null;
    this.systemInfo = null;
    this.invalidate();
  }

  markConnected(profile: SshProfile): void {
    this.connected = true;
    this.connecting = false;
    this.profile = profile;
    this.invalidate();
  }

  setConnected(profile: SshProfile): void {
    this.connected = true;
    this.profile = profile;
    this.buffer = [];
    this.scrollOffset = 0;
    this.lastExitCode = null;
    this.invalidate();
  }

  setDisconnected(): void {
    this.connected = false;
    this.invalidate();
  }

  clear(): void {
    this.buffer = [];
    this.scrollOffset = 0;
    this.invalidate();
  }

  // --- Component interface ---

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }
    const theme = this.themeRef;
    if (!theme) {
      this.cachedLines = [];
      return [];
    }

    const lines: string[] = [];

    // Header line
    lines.push(this.renderHeader(width, theme));

    // Separator
    lines.push(theme.fg("dim", "─".repeat(width)));

    // Output lines
    const visibleCount = DEFAULT_VISIBLE_LINES;
    const totalLines = this.buffer.length;
    const endIndex = Math.max(0, totalLines - this.scrollOffset);
    const startIndex = Math.max(0, endIndex - visibleCount);
    const slice = this.buffer.slice(startIndex, endIndex);

    // Empty state when connected but no output
    if (totalLines === 0 && this.connected) {
      lines.push(theme.fg("dim", "  Waiting for output — run commands via ssh_bash or ! prefix"));
      // Pad remaining lines
      for (let i = 1; i < visibleCount; i++) {
        lines.push("");
      }
    } else if (totalLines === 0) {
      // Disconnected empty
      while (slice.length < visibleCount) {
        slice.unshift("");
      }
      for (const line of slice) {
        lines.push(truncateToWidth(line, width));
      }
    } else {
      // Line number width: right-align up to 3 digits (999)
      const numW = totalLines > 999 ? 4 : 3;
      const contentW = Math.max(4, width - numW - 1); // -1 for space separator

      for (let i = 0; i < slice.length; i++) {
        const lineNum = startIndex + i + 1;
        const numStr = String(lineNum).padStart(numW);
        const prefix = theme.fg("dim", numStr + " ");
        const content = truncateToWidth(slice[i] || "", contentW);
        lines.push(prefix + content);
      }
    }

    // Footer: scroll info + key hints
    lines.push(this.renderFooter(width, theme, totalLines, startIndex, endIndex));

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.scrollOffset = Math.min(this.scrollOffset + 1, Math.max(0, this.buffer.length - 1));
      this.invalidate();
    } else if (matchesKey(data, Key.down)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
    } else if (matchesKey(data, Key.end) || matchesKey(data, "G")) {
      this.scrollOffset = 0;
      this.invalidate();
    } else if (matchesKey(data, Key.ctrl("l"))) {
      this.clear();
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  // Called by the widget factory to inject theme
  setTheme(theme: any): void {
    this.themeRef = theme;
    this.invalidate();
  }

  // --- Private helpers ---

  private renderHeader(width: number, theme: any): string {
    // Connecting state
    if (this.connecting && this.profile) {
      const host = `${this.profile.username}@${this.profile.host}`;
      const port = this.profile.port !== 22 ? `:${this.profile.port}` : "";
      return truncateToWidth(
        theme.fg("warning", "SSH ⟳") + " " + theme.fg("dim", `connecting to ${host}${port}…`),
        width
      );
    }

    // Disconnected state
    if (!this.connected || !this.profile) {
      return truncateToWidth(theme.fg("dim", "SSH ✗ not connected"), width);
    }

    // Connected: build host + system badge + exit code
    const host = `${this.profile.username}@${this.profile.host}`;
    const port = this.profile.port !== 22 ? `:${this.profile.port}` : "";

    let badge = "";
    if (this.systemInfo) {
      const os = this.systemInfo.os !== "unknown" ? this.systemInfo.os : "";
      const pm = this.systemInfo.packageManager !== "unknown" ? this.systemInfo.packageManager : "";
      const parts = [os, pm].filter(Boolean);
      if (parts.length > 0) {
        badge = " " + theme.fg("dim", `[${parts.join("/")}]`);
      }
    }

    let exitStr = "";
    if (this.lastExitCode !== null) {
      exitStr = this.lastExitCode === 0
        ? "  " + theme.fg("success", "exit 0")
        : "  " + theme.fg("error", `exit ${this.lastExitCode}`);
    }

    const prefix = theme.fg("success", "SSH ●") + " ";
    const hostPart = theme.fg("accent", theme.bold(host + port));
    const suffix = badge + exitStr;

    // Fit host+port first, then badge+exit, truncate host if needed
    const minSuffixW = 20; // reserve space for badge+exit
    const available = Math.max(20, width - minSuffixW);
    let truncatedHost = truncateToWidth(hostPart, available);

    return truncateToWidth(prefix + truncatedHost + suffix, width);
  }

  private renderFooter(width: number, theme: any, totalLines: number, startIndex: number, endIndex: number): string {
    if (totalLines === 0) {
      return theme.fg("dim", "↑↓ scroll  End=bottom  Ctrl+L=clear");
    }

    const visible = endIndex - startIndex;
    const posInfo = `lines ${startIndex + 1}-${endIndex}/${totalLines}`;
    const scrolled = this.scrollOffset > 0
      ? theme.fg("warning", `  ↑${this.scrollOffset} above`)
      : "";
    const keys = theme.fg("dim", "  ↑↓ scroll  End=bottom  Ctrl+L=clear");

    return truncateToWidth(theme.fg("dim", posInfo) + scrolled + keys, width);
  }
}
