# Architecture — pi-ssh-link

pi-ssh-link gives an AI agent persistent "hands" on a remote Linux server. This document explains how it works.

## Overview

```
┌──────────────────────────┐
│        pi agent          │
│  (LLM tool calls)        │
└─────┬────────────────────┘
      │ ssh_bash / ssh_read / ssh_write / ssh_edit / ssh_detect_system
      ▼
┌──────────────────────────┐
│     tools.ts             │  ← 5 tools, each with null-guards
│     (registerTools)      │
└─────┬────────────────────┘
      │
      ▼
┌──────────────────────────┐
│     index.ts             │  ← /ssh command handler
│     (SshSession)         │
└─────┬────────────────────┘
      │
      ▼
┌──────────────────────────┐
│     session.ts           │  ← owns connection + system info
│     (SshSession)         │
└─────┬────────────────────┘
      │
      ▼
┌──────────────────────────┐
│     connection.ts        │  ← persistent PTY shell via ssh2
│     (SshConnection)      │
└─────┬────────────────────┘
      │
      ▼
┌──────────────────────────┐
│   Remote Linux Server    │
│  (bash/sh via PTY)       │
└──────────────────────────┘

┌──────────────────────────┐
│   terminal-window.ts     │  ← live Windows Terminal popup
│   (human visibility)     │
└──────────────────────────┘
```

## Key Design Decisions

### 1. Printable Sentinels Instead of Control Characters

The original plan used ASCII `\x1e` (Record Separator) as command delimiters. In practice, control characters get mangled by PTY line discipline on the remote side — they can be stripped, corrupted, or echoed differently.

**Solution:** Printable sentinels with a unique prefix:

```
__PI_SSH_START_1712345678__
__PI_SSH_END_1712345678__0
```

- Prefix `__PI_SSH_` is unlikely to appear in normal command output
- The ID (timestamp) makes each sentinel unique per call
- The exit code is appended after the end sentinel in plain text
- Survives PTY processing, echo suppression, and all shell environments

### 2. Echo Suppression

When a PTY shell echoes the command text back, it pollutes stdout output and breaks sentinel parsing.

**Solution:** On connect, the shell sends:

```bash
stty -echo 2>/dev/null
stty cols 1000 2>/dev/null
```

- `stty -echo` prevents the remote terminal from echoing the command
- `stty cols 1000` sets very wide columns to prevent line-wrapping, which would insert newlines in the middle of sentinel output

### 3. Command Queuing

The SSH connection is a single PTY stream. If the LLM calls multiple tools concurrently, concurrent writes to the shell would produce garbled output.

**Solution:** A simple queue (`this.queue` in `SshConnection`):
- If a command is in flight (`this.busy = true`), subsequent calls push their executor to a queue
- When the active command finishes, `this.next()` dequeues and runs the next
- Timeouts interrupt the current command via `\x03` and drain the queue

### 4. Base64 File Transfers

Shell escaping is notoriously tricky — filenames with spaces, special characters, quotes, and binary content all break naive `echo > file` approaches.

**Solution:** Chunked Base64 transfer for `ssh_write`:

1. `mkdir -p "$(dirname <path>)" && > <path>.b64`
2. For each 32KB chunk: `echo -n '<base64>' >> <path>.b64`
3. `base64 -d < <path>.b64 > <path> && rm <path>.b64`

For `ssh_edit`, the file is read via `base64 <path>`, decoded, string-replaced, re-encoded, and written back: `echo '<base64>' | base64 -d > <path>`.

### 5. Auto System Detection

Different Linux distributions use different package managers and have different default shells.

**Solution:** On connect, `system-detect.ts` runs two commands:
- `cat /etc/os-release` — identifies Alpine, Ubuntu, Debian, Arch
- `id` — identifies the user and whether they have sudo/wheel access

This produces a structured `SystemInfo` object used by the AI to adapt its commands.

## Module Breakdown

### `types.ts`
Pure type definitions — `SshProfile`, `CommandResult`, `SystemInfo`. No runtime code.

### `utils.ts`
- Sentinel factory functions (`makeReadySentinel`, `makeStartSentinel`, `makeEndSentinel`)
- `stripAnsi()` — removes ANSI escape sequences and carriage returns
- `truncateOutput()` — safely truncates long output (halves from both ends)
- `formatResult()` — formats a `CommandResult` for display

### `connection.ts` — The Core Engine
The `SshConnection` class manages the full lifecycle:

| Method | Purpose |
|--------|---------|
| `connect(profile)` | Opens SSH connection, spawns PTY shell, sends stty setup, waits for READY sentinel |
| `exec(cmd, timeout)` | Wraps a command in sentinels, writes to the PTY, parses the response, returns `CommandResult` |
| `disconnect()` | Closes shell and client streams |
| `isConnected` | Getter for connection state |

Key details:
- Handshake timeout of 15s with a polling interval of 50ms checking for the READY sentinel
- Command timeout sends `\x03` to interrupt hung processes
- Double-resolve protection via `resolved` flag in `connect()`
- Strip ANSI from all output before returning to caller

### `session.ts`
Simple state holder that wires `SshConnection`, `TerminalWindow`, and `SystemInfo` together.

### `system-detect.ts`
Runs `cat /etc/os-release` and `id`, parses the output using string matching. Returns a `SystemInfo` with:
- `os` — one of alpine, debian, ubuntu, arch, unknown
- `packageManager` — one of apk, apt, pacman, unknown
- `user` — extracted from `uid=1000(foo)` in the `id` output
- `hasSudo` — true if user is root or has (sudo)/(wheel) group

### `terminal-window.ts`
Windows-only feature for human visibility:
- Creates a temp `.log` file and a `.ps1` PowerShell script
- The script runs `Get-Content -Wait <log> -Tail 50` in a new Windows Terminal or cmd.exe window
- All SSH output is written to the log file, giving a real-time view of what's happening on the remote server
- Cleans up temp files on disconnect

### `tools.ts` — The LLM Interface
Five tools registered via `pi.registerTool()`:

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `ssh_bash` | command, timeout_seconds | Executes any shell command, returns stdout + exit code |
| `ssh_read` | path, max_lines | Reads a remote file via `cat` or `head -n` |
| `ssh_write` | path, content | Writes file via Base64 chunked transfer |
| `ssh_edit` | path, old_str, new_str | Reads file, replaces text, writes back |
| `ssh_detect_system` | (none) | Returns structured `SystemInfo` as JSON |

All tools have a `guard()` that throws if `session.conn` is null, preventing null-reference crashes.

### `index.ts` — Entry Point
Registers the `/ssh` command with three subcommands:
- `/ssh connect [user@]host[:port] [-p <password>]` — connects and runs system detection
- `/ssh disconnect` — clean teardown
- `/ssh status` — displays current connection info

Tools are registered lazily on first connect (via `ensureTools()`), so they don't clutter the tool list until a session is active.

The `session_shutdown` event handler ensures clean disconnection when pi exits or reloads.

### `skills/ssh-link/SKILL.md`
A skill document that tells the AI how to use the SSH tools effectively:
- Warns that the session is **stateful** (cd, env vars persist)
- Recommends running `ssh_detect_system` first
- Maps OS to package manager commands
- Warns against `sed`/`echo >` for config edits — use `ssh_edit`/`ssh_write` instead
- Reminds the LLM to use non-interactive flags to avoid hung sessions

## Data Flow

```
User: "/ssh connect root@host"
  → index.ts parseProfile() → profile object
  → session.ts connect(profile)
    → terminal-window.ts open()  [spawns terminal popup]
    → connection.ts connect(profile)
      → ssh2 Client → shell({ term: "xterm-256color" })
      → write "stty -echo && stty cols 1000 && echo __PI_SSH_READY__\n"
      → poll buffer for READY sentinel → resolve
    → system-detect.ts detectSystem(conn)
      → connection.ts exec("cat /etc/os-release")
      → connection.ts exec("id")
      → return SystemInfo
  → tools registered via registerTools()
  → notify user with OS info

Agent calls ssh_bash: "apt-get update"
  → tools.ts guard() → connection.ts exec("apt-get update")
    → write "echo __PI_SSH_START_123__; apt-get update; echo __PI_SSH_END_123__0\n"
    → poll for END sentinel in output buffer
    → parse exit code, strip ANSI
    → return CommandResult { stdout, stderr, exitCode }
```

## Performance Considerations

- **Chunk size:** Base64 chunks are 32KB — large enough to minimize round-trips, small enough to avoid shell argument limits
- **Output truncation:** Results over 8000 chars are truncated (halved from both ends with a truncation notice)
- **Timeout:** Default 30s per command, configurable per call
- **Keepalive:** SSH keepalive every 10s with 3 retries

## Future Improvements

- SFTP-based file transfer (faster for large files)
- Support for non-Windows terminal windows
- SSH key agent forwarding
- Multiple concurrent sessions
- Session persistence (reconnect on disconnect)
