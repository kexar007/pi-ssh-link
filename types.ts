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

export interface SystemInfo {
  os: "alpine" | "debian" | "ubuntu" | "arch" | "unknown";
  packageManager: "apk" | "apt" | "pacman" | "unknown";
  hasSudo: boolean;
  user: string;
}
