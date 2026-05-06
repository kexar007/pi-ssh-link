// Printable sentinel prefix that survives PTY mangling.
// Control characters (0x1E, etc.) get corrupted by remote PTY line discipline.
const SENTINEL_PREFIX = "__PI_SSH_";

export function makeReadySentinel(): string {
  return `${SENTINEL_PREFIX}READY_`;
}

export function makeStartSentinel(id: number): string {
  return `${SENTINEL_PREFIX}START_${id}__`;
}

export function makeEndSentinel(id: number): string {
  return `${SENTINEL_PREFIX}END_${id}__`;
}

export function parseEndSentinel(text: string): { id: number; exitCode: number } | null {
  const m = text.match(/__PI_SSH_END_(\d+)__(\d+)/);
  if (!m) return null;
  return { id: parseInt(m[1], 10), exitCode: parseInt(m[2], 10) };
}

export function stripAnsi(t: string): string {
  return t.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

export function truncateOutput(t: string, max = 8000): string {
  if (t.length <= max) return t;
  const h = Math.floor(max / 2);
  return t.slice(0, h) + `\n\n[... ${t.length - max} chars truncated ...]\n\n` + t.slice(-h);
}

import type { CommandResult } from "./types.js";

export function formatResult(res: CommandResult): string {
  let out = res.stdout;
  if (res.stderr) out += `\n[stderr]\n${res.stderr}`;
  if (res.exitCode !== 0) out += `\n[exit code: ${res.exitCode}]`;
  return out;
}
