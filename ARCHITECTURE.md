# Architecture — pi-ssh-link

pi-ssh-link gives an AI agent persistent "hands" on a remote Linux server. This document explains how it works.

## Overview

```
┌───────────────────────────────┐
│         pi agent              │
│   (LLM tool calls)            │
└──────┬────────────────────────┘
       │ ssh_bash / ssh_read / ssh_write / ssh_edit / ssh_detect_system
       ▼
┌───────────────────────────────┐
│      tools.ts                 │  ← 6 tools, null-guards, renderCall/renderResult
│      (registerTools)          │
└──────┬────────────────────────┘
       │
       ▼
┌───────────────────────────────┐
│      index.ts                 │  ← /ssh command, shortcut, user_bash hook
│      (SshSession)             │
└──────┬────────────────────────┘
       │
       ▼
┌───────────────────────────────┐
│      session.ts               │  ← owns connection, system info, UI manager
│      (SshSession)             │
└──┬───────┬────────────────────┘
   │       │
   ▼       ▼
┌──────────┴────────────────────┐
│  connection.ts                │  ← persistent PTY shell via ssh2
│  (SshConnection)              │     emits raw output + exit codes via callbacks
└──────────┬────────────────────┘
           │
           ▼
┌───────────────────────────────┐
│    Remote Linux Server        │
│   (bash/sh via PTY)           │
└───────────────────────────────┘

┌───────────────────────────────┐
│  ui-manager.ts                │  ← wires TUI widget + footer
│  (UiManager)                  │
└──┬────────────────────────────┘
   │
   ▼
┌───────────────────────────────┐
│  ssh-panel.ts                 │  ← native pi TUI panel
│  (SshPanel)                   │     200-line circular buffer, scrollable,
│                               │     shows connection info + exit codes
└───────────────────────────────┘
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

### 6. Native TUI Panel Instead of External Terminal

The original implementation used a Windows Terminal popup (`terminal-window.ts`) via PowerShell scripts. This was Windows-only, fragile, and spawned external processes.

**Solution:** A native pi TUI panel implemented entirely in TypeScript:
- `SshPanel` — a `Component`-interface class with a 200-line circular buffer
- `UiManager` — wires the panel into pi's `setWidget`/`setStatus` APIs
- No external processes, no PowerShell, no platform restrictions
- Works on Linux, macOS, Windows, and Termux
- Scrollable with arrow keys, toggleable with `ctrl+shift+s`

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
- Constructor takes `(onOutput, onExitCode?)` callbacks — emits raw output and exit codes for the TUI panel
- Handshake timeout of 15s with a polling interval of 50ms checking for the READY sentinel
- Command timeout sends `\x03` to interrupt hung processes
- Double-resolve protection via `resolved` flag in `connect()`
- Strip ANSI from all output before returning to caller

### `session.ts`
State holder that wires `SshConnection`, `UiManager`, and `SystemInfo` together.
- `connect(profile, ctx)` — updates UI context, creates connection with callbacks, runs system detection, triggers `ui.onConnect()`
- `disconnect()` — tears down connection and calls `ui.onDisconnect()`

### `ssh-panel.ts` — The Live TUI Panel
A `Component`-interface class that renders SSH output inside pi's own interface:

| Method | Purpose |
|--------|---------|
| `write(text)` | Appends output text to the circular buffer (strips ANSI, caps at 200 lines) |
| `setExitCode(code)` | Updates the last exit code shown in the header |
| `setConnected(profile)` | Resets buffer, shows connection header |
| `setDisconnected()` | Shows disconnection header |
| `render(width)` | Returns rendered lines for the TUI |
| `handleInput(data)` | Processes arrow keys for scrolling |
| `invalidate()` | Clears cached render state |

The header line shows:
- Green `SSH ●` indicator when connected
- Remote host in accent color
- Exit code (green `exit:0` or red `exit:<code>`) after each command

### `ui-manager.ts` — TUI Wiring
Manages the lifecycle of the TUI widget and footer status:

| Method | Purpose |
|--------|---------|
| `updateContext(ctx)` | Stores fresh context, injects theme into panel |
| `onConnect(profile)` | Mounts widget, updates footer |
| `onDisconnect()` | Clears widget and footer |
| `onOutput(text)` | Forwards to panel |
| `onExitCode(code)` | Forwards to panel |
| `togglePanel()` | Shows/hides the panel |

Uses `ctx.ui.setWidget("ssh-panel", factory)` with a component factory that passes the theme from the TUI callback into `SshPanel.setTheme()`.

### `system-detect.ts`
Runs `cat /etc/os-release` and `id`, parses the output using string matching. Returns a `SystemInfo` with:
- `os` — one of alpine, debian, ubuntu, arch, unknown
- `packageManager` — one of apk, apt, pacman, unknown
- `user` — extracted from `uid=1000(foo)` in the `id` output
- `hasSudo` — true if user is root or has (sudo)/(wheel) group

### `tools.ts` — The LLM Interface
Six tools registered via `pi.registerTool()`:

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `ssh_bash` | command, timeout_seconds | Executes any shell command, returns stdout + exit code |
| `ssh_read` | path, max_lines | Reads a remote file via `cat` or `head -n` |
| `ssh_write` | path, content | Writes file via Base64 chunked transfer |
| `ssh_edit` | path, old_str, new_str | Reads file, replaces text, writes back |
| `ssh_detect_system` | (none) | Returns structured `SystemInfo` as JSON |
| `ssh_status` | (none) | Returns connection status and reconnect attempts |

All tools have `guard()` that throws if `session.conn` is null. Each tool also has `renderCall` and `renderResult` methods for rich inline rendering in pi's chat output — showing colours, exit codes, and file paths.

### `index.ts` — Entry Point
Registers the `/ssh` command with three subcommands:
- `/ssh connect [user@]host[:port] [-p <password>]` — connects and runs system detection
- `/ssh disconnect` — clean teardown
- `/ssh status` — displays current connection info

Also registers at the top level:
- `ctrl+shift+s` shortcut — toggles the SSH output panel
- `user_bash` handler — routes `!command` through SSH when connected
- `agent_start` handler — keeps the UI context fresh
- `session_shutdown` handler — ensures clean disconnection

Tools are registered lazily on first connect (via `ensureTools()`), so they don't clutter the tool list until a session is active.

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
  → session.ts connect(profile, ctx)
    → ui-manager.ts updateContext(ctx)
    → connection.ts connect(profile)  [with onOutput/onExitCode callbacks]
      → ssh2 Client → shell({ term: "xterm-256color" })
      → write "stty -echo && stty cols 1000 && echo __PI_SSH_READY__\n"
      → poll buffer for READY sentinel → resolve
    → system-detect.ts detectSystem(conn)
      → connection.ts exec("cat /etc/os-release")
      → connection.ts exec("id")
      → return SystemInfo
    → ui-manager.ts onConnect(profile)
      → ctx.ui.setWidget("ssh-panel", factory)
      → ctx.ui.setStatus("ssh-link", "● SSH connected  ctrl+shift+s: toggle panel")
  → tools registered via registerTools()
  → notify user with OS info

Agent calls ssh_bash: "apt-get update"
  → tools.ts guard() → connection.ts exec("apt-get update")
    → onOutput emitted for each data chunk → ssh-panel.ts write()
    → write "echo __PI_SSH_START_123__; apt-get update; echo __PI_SSH_END_123__0\n"
    → poll for END sentinel in output buffer
    → parse exit code → onExitCode emitted → ssh-panel.ts setExitCode()
    → strip ANSI
    → return CommandResult { stdout, stderr, exitCode }
  → tools.ts renderResult() colours exit code (green/red)
  → TUI panel shows live output and final exit code

User presses ctrl+shift+s
  → ui-manager.ts togglePanel()
  → ctx.ui.setWidget("ssh-panel", undefined) or re-mounts widget
```

## Performance Considerations

- **Chunk size:** Base64 chunks are 32KB — large enough to minimize round-trips, small enough to avoid shell argument limits
- **Output truncation:** Results over 8000 chars are truncated (halved from both ends with a truncation notice)
- **Timeout:** Default 30s per command, configurable per call
- **Keepalive:** SSH keepalive every 10s with 3 retries
- **Panel buffer:** 200-line circular buffer prevents memory leaks on long-running sessions

## Future Improvements

- SFTP-based file transfer (faster for large files)
- SSH key agent forwarding
- Multiple concurrent sessions
- Session persistence (reconnect on disconnect)
