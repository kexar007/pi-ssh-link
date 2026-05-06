---
name: ssh-link
description: Universal remote system management via persistent SSH (pi-ssh-link). Use for installing packages, editing configs, managing services, reading/writing files, and running commands on remote Linux servers. Supports Alpine (apk), Debian/Ubuntu (apt), and Arch (pacman).
---

# Skill: Universal Remote System Management

## Persistence Notice
- The SSH session is **stateful**.
- If you run `ssh_bash: cd /var/www`, all subsequent `ssh_bash` calls will start in `/var/www`.
- Environment variables exported via `export VAR=val` will persist.

## Phase 1: Recon
Run `ssh_detect_system` immediately. This identifies the Package Manager (`apk`, `apt`, `pacman`) and your privileges.

## Phase 2: Adaptation
- **Alpine:** Default shell is `ash`. Use `apk add`. No bash-specific syntax.
- **Ubuntu/Debian:** Use `apt-get install -y`.
- **Arch:** Use `pacman -S --noconfirm`.

## Phase 3: Tool Selection
- **NEVER use `sed` or `echo >`** for config edits. Use `ssh_edit` (surgical) or `ssh_write` (full).
- **Interactive Prompts:** Always use non-interactive flags (`-y`). Commands like `top` or `vim` will freeze the session.
