export interface SshProfile {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type OsType =
  | "alpine" | "ubuntu" | "debian" | "raspberrypi"
  | "fedora" | "rhel" | "arch" | "opensuse" | "void"
  | "nixos" | "gentoo" | "openwrt" | "freebsd" | "openbsd"
  | "macos" | "termux" | "unknown";

export type PackageManager =
  | "apk" | "apt" | "dnf" | "yum" | "pacman"
  | "xbps" | "zypper" | "nix" | "brew" | "opkg"
  | "pkg" | "emerge" | "unknown";

export type Arch =
  | "x86_64" | "arm64" | "armv7" | "armv6" | "x86" | "riscv64" | "unknown";

export type Shell = "bash" | "zsh" | "fish" | "ash" | "sh" | "unknown";

export interface SystemInfo {
  os:             OsType;
  packageManager: PackageManager;
  arch:           Arch;
  user:           string;
  hasSudo:        boolean;
  shell:          Shell;
  isContainer:    boolean;
  isTermux:       boolean;
  raw:            { uname: string; osRelease: string };
}
