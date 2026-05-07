import type { SshConnection } from "./connection.js";
import type { SystemInfo } from "./types.js";

export async function detectSystem(conn: SshConnection): Promise<SystemInfo> {
  // Run all probes in parallel — one round-trip per logical group
  const [envOut, osReleaseOut, fallbackOut, pmProbeOut, unameOut, idOut] =
    await Promise.allSettled([
      conn.exec(
        'printf "TERMUX_VERSION=%s\\nPREFIX=%s\\nANDROID_ROOT=%s\\n" ' +
        '"$TERMUX_VERSION" "$PREFIX" "$ANDROID_ROOT"',
        5000
      ),
      conn.exec("cat /etc/os-release 2>/dev/null", 5000),
      conn.exec(
        "{ cat /etc/alpine-release 2>/dev/null && echo __ALPINE__; } ; " +
        "{ cat /etc/debian_version 2>/dev/null && echo __DEBIAN__; } ; " +
        "{ cat /etc/fedora-release 2>/dev/null && echo __FEDORA__; } ; " +
        "{ cat /etc/redhat-release 2>/dev/null && echo __REDHAT__; } ; " +
        "{ cat /etc/openwrt_release 2>/dev/null && echo __OPENWRT__; } ; true",
        5000
      ),
      conn.exec(
        "command -v apk apt dnf yum pacman xbps-install zypper nix brew opkg pkg emerge 2>/dev/null",
        5000
      ),
      conn.exec("uname -a", 5000),
      conn.exec("id", 5000),
    ]);

  const env      = envOut.status      === "fulfilled" ? envOut.value.stdout      : "";
  const osRel    = osReleaseOut.status === "fulfilled" ? osReleaseOut.value.stdout : "";
  const fallback = fallbackOut.status  === "fulfilled" ? fallbackOut.value.stdout  : "";
  const pmProbe  = pmProbeOut.status   === "fulfilled" ? pmProbeOut.value.stdout   : "";
  const uname    = unameOut.status     === "fulfilled" ? unameOut.value.stdout     : "";
  const idStr    = idOut.status        === "fulfilled" ? idOut.value.stdout        : "";

  // --- Termux detection (Layer 1) ---
  const isTermux =
    env.includes("TERMUX_VERSION=") && !env.includes("TERMUX_VERSION=\n") ||
    env.includes("/data/data/com.termux") ||
    uname.toLowerCase().includes("android");

  // --- Parse /etc/os-release ID fields (Layer 2) ---
  const getOsReleaseField = (field: string): string => {
    const m = osRel.match(new RegExp(`^${field}=["']?([^"'\\n]+)["']?`, "m"));
    return m ? m[1].toLowerCase().trim() : "";
  };
  const osId     = getOsReleaseField("ID");
  const osIdLike = getOsReleaseField("ID_LIKE");

  // --- Determine OS type ---
  type OsType = SystemInfo["os"];
  let osType: OsType = "unknown";

  if (isTermux) {
    osType = "termux";
  } else if (osId === "alpine" || fallback.includes("__ALPINE__")) {
    osType = "alpine";
  } else if (osId === "raspbian" || (osId === "debian" && uname.toLowerCase().includes("raspberry"))) {
    osType = "raspberrypi";
  } else if (osId === "ubuntu" || osIdLike.includes("ubuntu")) {
    osType = "ubuntu";
  } else if (osId === "debian" || osIdLike.includes("debian") || fallback.includes("__DEBIAN__")) {
    osType = "debian";
  } else if (osId === "fedora" || fallback.includes("__FEDORA__")) {
    osType = "fedora";
  } else if (["rhel", "centos", "rocky", "almalinux", "ol"].includes(osId) || fallback.includes("__REDHAT__")) {
    osType = "rhel";
  } else if (osId === "arch" || osIdLike.includes("arch")) {
    osType = "arch";
  } else if (osId === "opensuse" || osId.startsWith("opensuse") || osIdLike.includes("suse")) {
    osType = "opensuse";
  } else if (osId === "void") {
    osType = "void";
  } else if (osId === "nixos") {
    osType = "nixos";
  } else if (osId === "gentoo") {
    osType = "gentoo";
  } else if (osId === "openwrt" || fallback.includes("__OPENWRT__")) {
    osType = "openwrt";
  } else if (uname.toLowerCase().includes("freebsd")) {
    osType = "freebsd";
  } else if (uname.toLowerCase().includes("openbsd")) {
    osType = "openbsd";
  } else if (uname.toLowerCase().includes("darwin")) {
    osType = "macos";
  }

  // --- Determine package manager ---
  // Priority: known OS mapping first, then binary probe fallback
  type PmType = SystemInfo["packageManager"];
  const pmMap: Partial<Record<OsType, PmType>> = {
    alpine:      "apk",
    raspberrypi: "apt",
    ubuntu:      "apt",
    debian:      "apt",
    fedora:      "dnf",
    rhel:        "dnf",   // modern RHEL/CentOS 8+ use dnf; yum is alias
    arch:        "pacman",
    opensuse:    "zypper",
    void:        "xbps",
    nixos:       "nix",
    gentoo:      "emerge",
    openwrt:     "opkg",
    freebsd:     "pkg",
    macos:       "brew",
    termux:      "pkg",   // Termux uses pkg (wrapper over apt)
  };

  let pm: PmType = pmMap[osType] ?? "unknown";

  // Layer 4 fallback: if still unknown, use binary probe results
  if (pm === "unknown") {
    if (pmProbe.includes("/apk"))     pm = "apk";
    else if (pmProbe.includes("/apt")) pm = "apt";
    else if (pmProbe.includes("/dnf")) pm = "dnf";
    else if (pmProbe.includes("/yum")) pm = "yum";
    else if (pmProbe.includes("/pacman")) pm = "pacman";
    else if (pmProbe.includes("/xbps-install")) pm = "xbps";
    else if (pmProbe.includes("/zypper")) pm = "zypper";
    else if (pmProbe.includes("/nix"))  pm = "nix";
    else if (pmProbe.includes("/brew")) pm = "brew";
    else if (pmProbe.includes("/opkg")) pm = "opkg";
    else if (pmProbe.includes("/emerge")) pm = "emerge";
    else if (pmProbe.includes("/pkg")) pm = "pkg";
  }

  // --- Architecture from uname ---
  let arch: SystemInfo["arch"] = "unknown";
  if (uname.includes("x86_64") || uname.includes("amd64"))          arch = "x86_64";
  else if (uname.includes("aarch64") || uname.includes("arm64"))     arch = "arm64";
  else if (uname.includes("armv7") || uname.includes("armhf"))       arch = "armv7";
  else if (uname.includes("armv6"))                                   arch = "armv6";
  else if (uname.includes("i686") || uname.includes("i386"))         arch = "x86";
  else if (uname.includes("riscv64"))                                 arch = "riscv64";

  // --- Container detection ---
  // This is best-effort — no single reliable method, so try several signals
  let isContainer = false;
  try {
    const cgroupRes = await conn.exec(
      "[ -f /proc/1/cgroup ] && cat /proc/1/cgroup 2>/dev/null | head -5 || true",
      3000
    );
    isContainer =
      cgroupRes.stdout.includes("docker") ||
      cgroupRes.stdout.includes("lxc") ||
      cgroupRes.stdout.includes("containerd");
  } catch { /* non-critical, ignore */ }

  // --- User info ---
  const user = idStr.match(/uid=\d+\(([^)]+)\)/)?.[1] || "unknown";
  const hasSudo =
    idStr.includes("(sudo)") ||
    idStr.includes("(wheel)") ||
    idStr.includes("(admin)") ||
    user === "root";

  // --- Shell detection ---
  let shell: SystemInfo["shell"] = "unknown";
  try {
    const shellRes = await conn.exec("echo $SHELL", 3000);
    const s = shellRes.stdout.trim();
    if (s.includes("bash"))      shell = "bash";
    else if (s.includes("zsh"))  shell = "zsh";
    else if (s.includes("fish")) shell = "fish";
    else if (s.includes("ash"))  shell = "ash";   // BusyBox / Alpine default
    else if (s.includes("sh"))   shell = "sh";
    else if (s)                  shell = "unknown";
  } catch { /* non-critical */ }

  return {
    os: osType,
    packageManager: pm,
    arch,
    user,
    hasSudo,
    shell,
    isContainer,
    isTermux,
    raw: { uname, osRelease: osRel },  // expose raw strings for debugging
  };
}
