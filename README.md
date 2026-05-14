# pi-ssh-link

> **Persistent SSH bridge for AI remote system management** — Give your AI agent stateful, reliable access to remote Linux servers with auto-detected OS support and safe file operations.

A [pi](https://pi.dev) extension that enables persistent SSH sessions with real-time TUI output, automatic system detection, and tools for command execution, file transfer, and configuration management.

---

## Features

- **Stateful SSH sessions** — Working directory and environment variables persist across all tool calls
- **Multi-OS support** — Auto-detects Alpine (apk), Debian/Ubuntu (apt), Arch (pacman), Fedora (dnf), and 10+ other distributions
- **PTY-safe command parsing** — Printable sentinels prevent terminal control-character corruption; command echo suppressed for clean output
- **Safe file operations** — Base64 chunked transfer and surgical string replacement to avoid shell escaping issues
- **Live TUI panel** — Real-time command output displayed in a native pi panel with line numbers, OS badge, and scroll controls
- **System auto-detection** — Identifies architecture (x86_64, ARM, RISC-V), user privileges, shell, and container environment
- **Graceful timeout & queueing** — Long-running commands time out and are interruptible; concurrent calls queue automatically
- **Rich UI rendering** — Command calls show labels, file paths, exit codes, and colored status in chat output
- **Cross-platform compatible** — Works on Linux, macOS, Windows, and Termux (no external processes required)

---

## Installation

### Via npm registry

```bash
pi install pi-ssh-link
```

### From source (development)

```bash
git clone https://github.com/kexar007/pi-ssh-link.git
pi -e ./pi-ssh-link
```

---

## Quick Start

### 1. Connect to a remote server

```
/ssh connect user@example.com
```

You'll be prompted for a password. Optionally specify a custom port and pass the password inline:

```
/ssh connect user@example.com:2222 -p your_password
```

### 2. View session status

```
/ssh status
```

Displays the current connection info, detected OS, package manager, and user privileges.

### 3. Let the AI manage your server

The AI agent now has access to five tools for remote management:

- Run commands with persistent state
- Read and modify files safely
- Detect system configuration automatically
- Install packages using the detected package manager
- Edit configuration files surgically

---

## Authentication

pi-ssh-link supports multiple authentication methods for connecting to remote servers:

### Password Authentication

```
/ssh connect user@example.com
```

You'll be prompted to enter your password interactively, or pass it inline:

```
/ssh connect user@example.com -p your_password
```

⚠️ **Security Warning:** Passing passwords as command-line arguments is visible in process listings and shell history. For production environments, use SSH keys or an SSH agent instead.

### SSH Key Authentication

If your SSH key is in the default location (`~/.ssh/id_rsa` or `~/.ssh/id_ed25519`), it will be used automatically:

```
/ssh connect user@example.com
```

To use a specific key file:

```
/ssh connect user@example.com -k ~/.ssh/my-custom-key
```

### SSH Agent

For the most secure approach, use an SSH agent to manage your keys:

```bash
# Start SSH agent (if not already running)
eval $(ssh-agent -s)

# Add your key to the agent
ssh-add ~/.ssh/id_rsa

# Now connect without specifying credentials
/ssh connect user@example.com
```

The SSH agent keeps your key in memory without exposing it to the command line or shell history.

### Best Practices for Authentication

- **Always use SSH keys** — More secure and scalable than passwords
- **Use SSH agent** — Protects keys from exposure in shell history and process listings
- **Never store passwords in scripts** — Use environment variables or interactive prompts
- **Limit key scope** — Use separate keys for different servers or services
- **Rotate keys regularly** — Follow your organization's key rotation policy

---

## Commands

| Command                                         | Description                             |
| ----------------------------------------------- | --------------------------------------- |
| `/ssh connect [user@]host[:port] [-p password]` | Establish a new SSH session             |
| `/ssh disconnect`                               | Close the current session               |
| `/ssh status`                                   | Show connection info and system details |

---

## Keyboard Shortcuts

| Shortcut | Action                               |
| -------- | ------------------------------------ |
| `Ctrl+Q` | Toggle the SSH output panel          |
| `Alt+K`  | Scroll up in the panel (vim-style)   |
| `Alt+J`  | Scroll down in the panel (vim-style) |
| `Alt+G`  | Jump to the bottom of the panel      |
| `Alt+L`  | Clear panel output                   |

---

## Tools for AI Agents

These tools are automatically available once connected to a server:

### `ssh_bash`

Run any shell command with persistent working directory and environment state.

**Parameters:**

- `command` (string, required) — Shell command to execute
- `timeout_seconds` (number, optional) — Timeout in seconds (default: 30)

**Example:**

```
ssh_bash: cd /var/www && ls -la
ssh_bash: export API_KEY=secret && ./deploy.sh
```

### `ssh_read`

Read a file from the remote server (supports limiting to first N lines).

**Parameters:**

- `path` (string, required) — Absolute path to the file
- `max_lines` (number, optional) — Limit output to first N lines

**Example:**

```
ssh_read: /etc/nginx/nginx.conf
ssh_read: /var/log/syslog (max_lines: 50)
```

### `ssh_write`

Write or create a file on the remote server with Base64 chunked transfer.

**Parameters:**

- `path` (string, required) — Absolute path where to write
- `content` (string, required) — File content to write

**Example:**

```
ssh_write: /tmp/script.sh | #!/bin/bash\necho "hello"
```

### `ssh_edit`

Perform surgical string replacement within an existing file.

**Parameters:**

- `path` (string, required) — Path to the file to edit
- `old_string` (string, required) — Exact string to replace
- `new_string` (string, required) — Replacement text

**Example:**

```
ssh_edit: /etc/nginx/nginx.conf
  old: server_name example.com;
  new: server_name example.com www.example.com;
```

### `ssh_detect_system`

Get structured OS, architecture, package manager, and user information.

**Returns:**

- `os` — Distribution (alpine, ubuntu, debian, fedora, arch, etc.)
- `packageManager` — Package manager (apk, apt, dnf, pacman, etc.)
- `arch` — Architecture (x86_64, arm64, armv7, etc.)
- `user` — Current username
- `hasSudo` — Whether user has sudo privileges
- `shell` — Default shell (bash, zsh, ash, sh, etc.)
- `isContainer` — Whether running in a container
- `isTermux` — Whether running in Termux

---

## How It Works

1. **Session initialization** — Opens a PTY shell via ssh2 with terminal size set to 1000 columns
2. **Terminal configuration** — Runs `stty -echo && stty cols 1000` to suppress command echo and prevent line wrapping
3. **Command execution** — Wraps commands with printable sentinels (`__PI_SSH_START_*` / `__PI_SSH_END_*`) to delimit output reliably
4. **Output parsing** — Extracts stdout/stderr between sentinels and captures exit codes from sentinel suffixes
5. **System detection** — Queries `/etc/os-release`, `uname`, and `id` to identify OS, architecture, and privileges
6. **File transfer** — Encodes files as Base64 in chunks to avoid shell metacharacter issues
7. **UI rendering** — Streams live output to a native TUI panel with theme-aware styling and scroll support

---

## Supported Operating Systems

| Family             | Distributions                                                 |
| ------------------ | ------------------------------------------------------------- |
| **Alpine/Minimal** | Alpine Linux, Alpine Linux Edge, OpenWrt                      |
| **Debian-based**   | Debian, Ubuntu, Raspberry Pi OS, Ubuntu on WSL                |
| **Red Hat-based**  | Fedora, RHEL, CentOS, Rocky Linux                             |
| **Arch-based**     | Arch Linux, Manjaro                                           |
| **Other**          | openSUSE, Void Linux, NixOS, Gentoo, FreeBSD, OpenBSD, Termux |

Each distribution's native package manager is auto-detected for seamless package installation.

---

## Requirements

- **[pi](https://pi.dev)** — Terminal AI coding agent (v0.74.0 or later)
- **Node.js** — 18.0.0 or later
- **SSH access** — Password or key-based authentication to a remote server
- **SSH server** — OpenSSH or compatible (most Linux distributions included)

---

## Best Practices

### Command Execution

- Use non-interactive flags when possible (`apt-get install -y`, `pacman -S --noconfirm`)
- Avoid interactive commands (vim, top, less) — they will freeze the session
- Always specify timeouts for long-running tasks
- Check `/ssh status` after connecting to confirm OS and privileges

### File Operations

- Use `ssh_edit` for small, targeted changes to configuration files
- Use `ssh_write` to create new files or replace entire contents
- Use `ssh_read` with `max_lines` for large log files to avoid excessive output
- Keep Base64-encoded file transfers under 10MB for best performance

### Session Management

- The SSH session persists until you run `/ssh disconnect`
- Each new command inherits the working directory and environment from previous commands
- Reconnection attempts are automatic; check `/ssh status` if you suspect a dropped connection
- Press `Ctrl+Q` to hide/show the output panel if it becomes distracting

---

## Troubleshooting

**"Not connected to any server" error**

- Run `/ssh connect` to establish a session first
- Verify SSH credentials (username, password, or key)
- Check that the remote server is reachable and SSH port (default 22) is open

**Commands timing out**

- Long-running tasks may exceed the default 30-second timeout
- Use `timeout_seconds` parameter to extend timeout as needed
- Consider breaking large operations into smaller commands

**File transfer failures**

- Base64 encoding works reliably but is slower than binary transfer
- Keep individual file writes under 10MB
- For very large files, use `scp` or `rsync` via shell commands instead

**Terminal state issues**

- If output appears corrupted, run `ssh_bash: reset` to reinitialize the terminal
- Clear the output panel with `Alt+L` if it becomes too cluttered

---

## Architecture

This extension is built on top of the pi Agent API and provides:

- **Extension hooks** — Registers SSH commands and tools with pi
- **TUI integration** — Native rendering in pi's terminal UI framework
- **Type safety** — Full TypeScript support for parameters and system detection
- **Graceful degradation** — Queues overlapping calls and handles connection loss

See [skills/ssh-link/SKILL.md](skills/ssh-link/SKILL.md) for AI agent integration guidelines.

---

## License

MIT

## Contributing

Contributions welcome! Please open issues and pull requests on [GitHub](https://github.com/kexar007/pi-ssh-link).

## Development

```bash
git clone https://github.com/kexar007/pi-ssh-link.git
cd pi-ssh-link
npm install
# Edit source, then test with:
pi -e ./
```

MIT
