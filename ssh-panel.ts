import { truncateToWidth, matchesKey, Key } from "@mariozechner/pi-tui";
import type { SshProfile } from "./types.js";
import { stripAnsi } from "./utils.js";

const MAX_BUFFER_LINES = 200;
const DEFAULT_VISIBLE_LINES = 10;

export class SshPanel {
  private buffer: string[] = [];
  private scrollOffset = 0;
  private connected = false;
  private profile: SshProfile | null = null;
  private lastExitCode: number | null = null;
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

    // Pad with empty lines if fewer than visibleCount
    while (slice.length < visibleCount) {
      slice.unshift("");
    }

    for (const line of slice) {
      lines.push(truncateToWidth(line, width));
    }

    // Scroll hint if scrolled up
    if (this.scrollOffset > 0) {
      const hint = theme.fg("dim", `↓ ${this.scrollOffset} more lines below (↑↓ to scroll, End to jump to bottom)`);
      lines.push(truncateToWidth(hint, width));
    }

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
    if (!this.connected || !this.profile) {
      return truncateToWidth(theme.fg("dim", "SSH ✗ not connected"), width);
    }

    const host = `${this.profile.username}@${this.profile.host}`;
    const port = this.profile.port !== 22 ? `:${this.profile.port}` : "";
    const exitStr = this.lastExitCode === null
      ? ""
      : this.lastExitCode === 0
        ? theme.fg("success", ` exit:0`)
        : theme.fg("error", ` exit:${this.lastExitCode}`);

    const header =
      theme.fg("success", "SSH ●") + " " +
      theme.fg("accent", theme.bold(host + port)) +
      exitStr;

    return truncateToWidth(header, width);
  }
}
