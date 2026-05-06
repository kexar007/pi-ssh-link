# pi-ssh-link 🔗

**Persistent SSH bridge for AI remote system management.**

> ⚠️ **ssh popup is Windows-only for now.** The live terminal popup feature uses Windows Terminal / CMD + PowerShell scripts. The core SSH engine (connection, tools, file ops, system detection) works on any platform, but the visual popup is Windows-specific.

pi-ssh-link gives your AI agent persistent "hands" on a remote Linux server. It opens a stateful SSH session with reliable command parsing (printable sentinels, PTY-safe), auto-detects the OS and package manager, and provides safe file operations via Base64 chunked transfer.

Built for [pi](https://pi.dev), the terminal AI coding agent.

## Features

- **Stateful persistent session** — `cd` into a directory, export env vars, they persist across tool calls
- **Auto system detection** — identifies Alpine (apk), Debian/Ubuntu (apt), Arch (pacman), user privileges
- **PTY-safe parsing** — printable sentinels (`__PI_SSH_`) avoid control-character corruption
- **Command echo eliminated** — `stty -echo` so the command text never bleeds into stdout
- **Safe file operations** — `ssh_write` uses Base64 chunked transfer, `ssh_edit` does surgical string replacement
- **Live terminal window** (Windows) — pops a Windows Terminal window showing real-time SSH output
- **Graceful timeout + queue** — commands time out and are interruptible; concurrent calls queue automatically

## Install

```bash
pi install git:github.com/kexar007/pi-ssh-link
```

Or clone and use locally:

```bash
git clone https://github.com/kexar007/pi-ssh-link.git
pi -e ./pi-ssh-link
```

## Usage

### Connect to a server

```
/ssh connect root@myserver.com
```

You'll be prompted for a password. Or pass it inline:

```
/ssh connect root@myserver.com:2222 -p mypassword
```

### Commands

| Command                                           | Description                             |
| ------------------------------------------------- | --------------------------------------- |
| `/ssh connect [user@]host[:port] [-p <password>]` | Connect to a remote server              |
| `/ssh disconnect`                                 | Close the current SSH session           |
| `/ssh status`                                     | Show connection info and system details |

### Tools (callable by the AI)

| Tool                | Description                                    |
| ------------------- | ---------------------------------------------- |
| `ssh_bash`          | Run any shell command (cd/env state persists)  |
| `ssh_read`          | Read a remote file                             |
| `ssh_write`         | Write content to a remote file (Base64 chunks) |
| `ssh_edit`          | Surgical string replacement in a remote file   |
| `ssh_detect_system` | Get structured OS/user/package-manager info    |

## How it works

1. Opens a PTY shell via `ssh2`
2. Sends `stty -echo && stty cols 1000` to suppress echo and prevent line-wrap mangling
3. Uses printable sentinels (`__PI_SSH_START_123__`, `__PI_SSH_END_123__0`) to delimit command output
4. Parses stdout between sentinels, extracts exit codes
5. Detects OS from `/etc/os-release` and user from `id`
6. Files are transferred as Base64 to avoid shell escaping issues

## Requirements

- [pi](https://pi.dev) terminal AI coding agent
- Node.js 18+
- SSH access to a Linux server
- Windows (for the terminal popup feature; SSH core works on any platform)

## Development

```bash
git clone https://github.com/kexar007/pi-ssh-link.git
cd pi-ssh-link
npm install
# Edit source, then test with:
pi -e ./
```

## License

MIT
