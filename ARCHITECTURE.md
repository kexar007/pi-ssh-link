# pi-ssh-link — Architecture

> Persistent SSH bridge for AI remote system management.

---

## Project Structure

```
pi-ssh-link/
├── index.ts                # Extension entry point — registers commands, shortcuts, event handlers
├── connection.ts           # SshConnection — SSH client, PTY shell, command queue, reconnect
├── session.ts              # SshSession — orchestrates connection, system detection, UI
├── tools.ts                # 6 AI tools: ssh_bash, ssh_read, ssh_write, ssh_edit,
│                           #   ssh_detect_system, ssh_status
├── types.ts                # TypeScript types: SshProfile, CommandResult, SystemInfo, enums
├── utils.ts                # Sentinels (__PI_SSH_START/END), stripAnsi, truncateOutput, formatResult
├── ssh-panel.ts            # SshPanel — TUI widget rendering SSH output buffer
├── ui-manager.ts           # UiManager — mounts/unmounts panel, toggle, scroll, clear
├── system-detect.ts        # detectSystem — OS, arch, package manager, container, Termux
├── skills/ssh-link/SKILL.md # Skill definition for AI agent guidance
├── package.json            # pi package manifest (extension + skills)
├── tsconfig.json
├── README.md
└── ARCHITECTURE.md         # This file
```

---

## Module Overview

### 1. Entry Point — `index.ts`

Registers the extension with pi's API. Responsibilities:

- **`/ssh` command** with three subcommands:
  - `connect [user@]host[:port] [-p password]` — parse connection string, prompt for password if missing, establish session
  - `disconnect` — tear down session, clear footer
  - `status` — display connection info and detected system
- **Keyboard shortcuts** for the TUI panel:
  - `Ctrl+Q` — toggle panel visibility
  - `Alt+J/K` — scroll down/up
  - `Alt+G` — jump to bottom
  - `Alt+L` — clear output
- **Event hooks:**
  - `user_bash` — route `!commands` through SSH when connected (rewrites the exec operation)
  - `agent_start` — refresh UI context
  - `session_shutdown` — disconnect SSH on pi shutdown
- **Footer widget** — live status bar showing `user@host [os/pm]` with reconnect count

### 2. SSH Connection — `connection.ts`

Core SSH client built on `ssh2`. Provides two execution modes:

#### PTY Shell (`exec`)
- Opens a `xterm-256color` PTY via `ssh2.Client.shell()`
- Initializes terminal: `stty -echo && stty cols 1000`
- Uses **printable sentinels** to delimit output:
  ```
  echo __PI_SSH_START_<id>_<rand>__; <command>; echo __PI_SSH_END_<id>_<rand>__$?
  ```
- Extracts stdout/stderr between sentinels and exit code from the suffix
- Printable sentinels (vs. control characters) survive PTY line discipline mangling
- **Output buffer** capped at 10MB to prevent OOM on runaway commands
- **Timeout** sends `\x03` (Ctrl+C) to interrupt hung processes

#### Raw Channel (`rawExec`)
- Uses `ssh2.Client.exec()` — a dedicated channel without PTY
- Binary-safe: no terminal line discipline, no sentinel wrapping
- Used for file reads (`ssh_read`)

#### Command Queue
- Sequential execution — overlapping calls are queued
- Busy flag prevents concurrent PTY commands
- On connection loss, all queued commands are rejected

#### Reconnection
- Up to 3 automatic attempts with exponential backoff (1s, 2s, 3s)
- Triggered when `exec()` detects a closed shell
- Stores `SshProfile` for reconnection

### 3. Session — `session.ts`

Orchestrates the connection lifecycle:

1. Stores profile and updates UI to "connecting" state
2. Creates `SshConnection` with output/exit-code callbacks bound to `UiManager`
3. Awaits connection
4. Runs best-effort system detection (failure never aborts connection)
5. Transitions UI to "connected" and pushes system info

### 4. Tools — `tools.ts`

Six AI-accessible tools registered via `pi.registerTool()`:

| Tool | Mechanism | Key Detail |
|------|-----------|------------|
| `ssh_bash` | `connection.exec()` | Persistent cwd and env vars |
| `ssh_read` | `connection.rawExec()` | Binary-safe via non-PTY channel; supports `max_lines` (head -n) |
| `ssh_write` | `connection.exec()` + Base64 | Chunked transfer (32KB chunks); atomic write via `mktemp` + `mv` |
| `ssh_edit` | `connection.exec()` for read/write | Base64-decodes file, checks exactly 1 match, re-encodes |
| `ssh_detect_system` | Delegates to `system-detect.ts` | Re-runs full detection |
| `ssh_status` | Reads `connection.getStatus()` | Returns connected/disconnected/reconnecting state |

All tools include:
- **TypeBox parameter schemas** for type-safe invocations
- **Custom render functions** (`renderCall`, `renderResult`) for rich TUI display
- **Error wrapping** — connection guard throws "Not connected" if no session

### 5. Types — `types.ts`

```typescript
interface SshProfile {
  host: string; port: number; username: string;
  privateKeyPath?: string; password?: string;
}

interface CommandResult {
  stdout: string; stderr: string; exitCode: number;
}

interface SystemInfo {
  os: OsType;            // "alpine" | "ubuntu" | "debian" | "fedora" | "arch" | ...
  packageManager: PmType; // "apk" | "apt" | "dnf" | "pacman" | "xbps" | ...
  arch: Arch;            // "x86_64" | "arm64" | "armv7" | "riscv64" | ...
  user: string;
  hasSudo: boolean;
  shell: Shell;          // "bash" | "zsh" | "ash" | "sh" | ...
  isContainer: boolean;
  isTermux: boolean;
  raw: { uname: string; osRelease: string };
}
```

Enums (`OsType`, `PackageManager`, `Arch`, `Shell`) cover 17+ OS distributions and 12 package managers.

### 6. Utilities — `utils.ts`

- **Sentinel generators:** `makeReadySentinel()`, `makeStartSentinel(id, rand)`, `makeEndSentinel(id, rand)` — all produce printable ASCII strings prefixed with `__PI_SSH_`
- **`parseEndSentinel(text)`** — regex extracts id and exit code from sentinel suffix
- **`stripAnsi(t)`** — removes ANSI escape sequences and `\r` characters
- **`truncateOutput(t, max=8000)`** — middle-truncation with `[... N chars truncated ...]`
- **`formatResult(res)`** — formats `CommandResult` for text display

### 7. TUI Panel — `ssh-panel.ts`

A custom pi-tui widget with:

- **Buffer management:** 200-line ring buffer, scroll offset
- **States:** connecting (spinner), connected (live), disconnected (offline)
- **Header:** `SSH ● user@host [os/pm] exit 0` (color-coded exit code)
- **Line numbers:** right-aligned 3-4 digit prefixes
- **Empty state:** hint text when connected but no commands run yet
- **Footer:** scroll position (`lines 1-10/45`) + key hints
- **Caching:** caches rendered output until `invalidate()` is called

### 8. UI Manager — `ui-manager.ts`

Bridge between `SshSession` and `SshPanel`:

- `updateContext(ctx)` — injects pi context and theme into panel
- `setConnecting(profile)` / `onConnect(profile)` / `onDisconnect()` — lifecycle transitions
- `onOutput(text)` / `onExitCode(code)` — stream data to panel + request render
- `togglePanel()` / `scrollUp/Down()` / `scrollToBottom()` / `clearPanel()` — shortcut handlers
- `mountWidget()` — registers panel as `ssh-panel` widget via `ctx.ui.setWidget()`

### 9. System Detection — `system-detect.ts`

Parallel probing strategy:

1. **Layer 1 — Environment:** `TERMUX_VERSION`, `PREFIX`, `ANDROID_ROOT` for Termux detection
2. **Layer 2 — os-release:** Parses `/etc/os-release` `ID` and `ID_LIKE` fields
3. **Layer 3 — Fallback files:** Probes `/etc/alpine-release`, `/etc/debian_version`, `/etc/fedora-release`, `/etc/redhat-release`, `/etc/openwrt_release`
4. **Layer 4 — Binary probe:** `command -v` for all known package managers
5. **Layer 5 — uname:** Architecture and kernel name (FreeBSD, OpenBSD, Darwin)
6. **Container detection:** Checks `/proc/1/cgroup` for docker/lxc/containerd
7. **User/privileges:** Parses `id` output for uid, groups (sudo/wheel/admin)
8. **Shell:** Reads `$SHELL` environment variable

All probes run in parallel via `Promise.allSettled()` (one round-trip per group). Failures are non-fatal — unknown values are filled in.

### 10. Skill — `skills/ssh-link/SKILL.md`

Guides the AI agent on how to use the SSH tools effectively:

- **Persistence notice:** stateful session (cwd, env vars)
- **Recon phase:** run `ssh_detect_system` first
- **Adaptation:** OS-specific package manager commands
- **Tool selection:** prefer `ssh_edit` / `ssh_write` over `sed` / `echo >`; always use non-interactive flags

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Printable sentinels** instead of control characters | Control chars (0x1E, etc.) get corrupted by remote PTY line discipline; printable ASCII `__PI_SSH_*` is reliable |
| **Two execution modes** (PTY exec + rawExec) | PTY is needed for stateful interactive shells (cwd, env); raw channel is binary-safe for file reads |
| **Base64 chunked file transfer** | Avoids shell escaping issues with special characters, newlines, and binary data |
| **Parallel system probes** | Minimizes round-trips — all probes finish in ~1-2 RTTs |
| **Best-effort detection, never abort** | A failed probe shouldn't prevent connection; defaults are filled |
| **Command queue** | SSH shell is single-stream; concurrent tool calls must be serialized |
| **10MB output cap** | Prevents OOM from runaway commands while supporting large outputs |
| **Atomic file writes** (temp + mv) | Prevents partial writes from corrupting critical config files |

---

## Data Flow

```
User command (/ssh connect)
        │
        v
  index.ts (parseProfile)
        │
        v
  SshSession.connect()
        │
        ├──► UiManager.setConnecting()  → mount TUI panel with spinner
        │
        ├──► SshConnection.connect()
        │       │
        │       ├── ssh2 Client.connect()
        │       ├── shell() → PTY
        │       ├── stty -echo, cols 1000
        │       └── echo __PI_SSH_READY__ (handshake)
        │
        ├──► detectSystem()
        │       └── parallel Promise.allSettled() probes
        │
        └──► UiManager.onConnect() / setSystemInfo()
                └── panel transitions to "connected" state
                        │
AI tool call (ssh_bash)  │
        │                │
        v                │
  SshConnection.exec()   │
        │                │
        ├── queue if busy│
        ├── write cmd to PTY with sentinels
        ├── stream output ──► UiManager.onOutput() ──► panel.write()
        ├── capture exit code ──► UiManager.onExitCode()
        └── resolve Promise with CommandResult
```

---

## Authentication Flow

```
/ssh connect user@host:2222 -p mypass
        │
        v
  parseProfile()
    ├── Extracts: username, host, port, password
    └── Returns: SshProfile { host, port, username, password? }
        │
        v
  SshConnection._connect(profile)
    ├── Priority:
    │   1. password (if provided)
    │   2. privateKeyPath (if provided via -k flag)
    │   3. SSH_AUTH_SOCK environment variable (SSH agent)
    │      On Windows: \\.\pipe\openssh-ssh-agent
    └── ssh2 ConnectConfig assembled accordingly
```

---

## Keyboard Shortcuts

| Shortcut | Handler Function | Description |
|----------|-----------------|-------------|
| `Ctrl+Q` | `ui.togglePanel()` | Show/hide SSH panel |
| `Alt+K`  | `ui.scrollUp()` | Scroll panel up |
| `Alt+J`  | `ui.scrollDown()` | Scroll panel down |
| `Alt+G`  | `ui.scrollToBottom()` | Jump to latest output |
| `Alt+L`  | `ui.clearPanel()` | Clear output buffer |

All shortcuts first call `ui.updateContext(ctx)` to ensure the panel has the latest pi context reference.

---

## Error Handling Strategy

- **Connection failures:** Catch at `/ssh connect` handler → notify user, call `session.disconnect()`
- **Detection failures:** Caught in `SshSession.connect()` → warn to console, fill defaults
- **Command timeouts:** `setTimeout` in `exec()` sends `\x03` (interrupt) and rejects promise
- **Output overflow:** 10MB hard cap → rejects with descriptive error
- **Connection lost mid-command:** `close`/`error` event on client → rejects all queued commands
- **Reconnect exhaustion:** After 3 attempts, throws "Max reconnect attempts reached"
- **Tool errors:** Each tool wraps execute body in try/catch → returns `{ isError: true, content: [error message] }`

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ssh2` | ^1.17.0 | SSH client library |
| `@earendil-works/pi-coding-agent` | ^0.74.0 | pi extension API types |
| `@earendil-works/pi-tui` | ^0.74.0 | TUI framework (Text, truncateToWidth) |
| `typebox` | ^1.1.38 | Runtime type validation for tool parameters |
| `typescript` | ^5.9.3 | TypeScript compiler |
