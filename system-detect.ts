import type { SshConnection } from "./connection.js";
import type { SystemInfo } from "./types.js";

export async function detectSystem(conn: SshConnection): Promise<SystemInfo> {
  const osRes = await conn.exec("cat /etc/os-release");
  const idRes = await conn.exec("id");
  const os = osRes.stdout;
  const id = idRes.stdout;
  const user = id.match(/uid=\d+\(([^)]+)\)/)?.[1] || "unknown";

  let pm: SystemInfo["packageManager"] = "unknown";
  if (os.includes("Alpine")) pm = "apk";
  else if (os.includes("Ubuntu") || os.includes("Debian")) pm = "apt";
  else if (os.includes("Arch")) pm = "pacman";

  let osType: SystemInfo["os"] = "unknown";
  if (os.includes("Alpine")) osType = "alpine";
  else if (os.includes("Ubuntu")) osType = "ubuntu";
  else if (os.includes("Debian")) osType = "debian";
  else if (os.includes("Arch")) osType = "arch";

  return {
    os: osType,
    packageManager: pm,
    user,
    hasSudo: id.includes("(sudo)") || id.includes("(wheel)") || user === "root",
  };
}
