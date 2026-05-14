import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SshSession } from "./session.js";
import { registerTools } from "./tools.js";
import type { SshProfile } from "./types.js";

export default function (pi: ExtensionAPI) {
  const session = new SshSession();
  let toolsRegistered = false;

  const updateFooter = (ctx: ExtensionCommandContext) => {
    if (!session.conn) {
      ctx.ui.setFooter(undefined);
      return;
    }
    ctx.ui.setFooter((_tui: any, theme: any) => ({
      render(_width: number) {
        const host = session.profile?.host ?? "";
        const user = session.system?.user ?? "";
        const os = session.system?.os ?? "";
        const pm = session.system?.packageManager ?? "";
        const reconnects: number = session.conn?.reconnectAttempts ?? 0;

        const hostStr = theme.fg("accent", `${user}@${host}`);
        const osStr = os ? theme.fg("dim", ` [${os}${pm ? " / " + pm : ""}]`) : "";
        const reconnectStr = reconnects > 0
          ? theme.fg("warning", ` ⚠ reconnects:${reconnects}`)
          : "";
        const dot = theme.fg("success", "● ");

        return [dot + hostStr + osStr + reconnectStr];
      },
      invalidate() {},
    }));
  };

  const ensureTools = () => {
    if (!toolsRegistered) {
      registerTools(pi, session);
      toolsRegistered = true;
    }
  };

  const parseProfile = (args: string): { profile: SshProfile; password?: string } => {
    // Format: [user@]host[:port] [-p|--password <password>]
    const parts = args.trim().split(/\s+/);
    let hostPart = "";
    let password: string | undefined;

    for (let i = 0; i < parts.length; i++) {
      if ((parts[i] === "-p" || parts[i] === "--password") && i + 1 < parts.length) {
        password = parts[i + 1];
        i++; // skip the value
      } else {
        hostPart = parts[i];
      }
    }

    let username = "root";
    let host = hostPart;
    let port = 22;

    if (hostPart.includes("@")) {
      const atParts = hostPart.split("@");
      username = atParts[0];
      host = atParts.slice(1).join("@");
    }

    if (host.startsWith("[")) {
      // Bracketed IPv6: [::1] or [::1]:2222
      const bracket = host.indexOf("]");
      if (bracket !== -1) {
        const afterBracket = host.slice(bracket + 1);
        host = host.slice(1, bracket);
        if (afterBracket.startsWith(":")) {
          const parsedPort = parseInt(afterBracket.slice(1), 10);
          if (!isNaN(parsedPort)) port = parsedPort;
        }
      }
    } else if (host.includes(":")) {
      const lastColon = host.lastIndexOf(":");
      const portStr = host.slice(lastColon + 1);
      host = host.slice(0, lastColon);
      const parsedPort = parseInt(portStr, 10);
      if (!isNaN(parsedPort)) port = parsedPort;
    }

    const profile: SshProfile = { host, port, username };
    if (password) profile.password = password;

    return { profile, password };
  };

  pi.registerCommand("ssh", {
    description: "SSH remote session management",
    getArgumentCompletions: (prefix: string) => {
      const subcommands = ["connect", "disconnect", "status"];
      const filtered = subcommands.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((v) => ({ value: v, label: v })) : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(" ");

      switch (sub) {
        case "connect": {
          if (!rest) {
            ctx.ui.notify("Usage: /ssh connect [user@]host[:port] [-p <password>]", "error");
            return;
          }
          if (session.conn) {
            ctx.ui.notify("Already connected. Disconnect first.", "error");
            return;
          }
          const { profile } = parseProfile(rest);

          // If no password was provided via CLI flag, prompt for it
          if (!profile.password) {
            const pw = await ctx.ui.input(
              `Password for ${profile.username}@${profile.host}:${profile.port}:`,
              "",
            );
            if (pw) profile.password = pw;
          }

          ctx.ui.notify(
            `Connecting to ${profile.username}@${profile.host}:${profile.port}...`,
            "info",
          );
          try {
            await session.connect(profile, ctx);
            ensureTools();
            ctx.ui.notify(
              `Connected! OS: ${session.system?.os}, user: ${session.system?.user}, pm: ${session.system?.packageManager}`,
              "info",
            );
            updateFooter(ctx);
          } catch (e: any) {
            ctx.ui.notify(`Connection failed: ${e.message}`, "error");
            session.disconnect();
          }
          return;
        }

        case "disconnect": {
          if (!session.conn) {
            ctx.ui.notify("Not connected.", "info");
            return;
          }
          session.disconnect();
          ctx.ui.setFooter(undefined);
          ctx.ui.notify("Disconnected.", "info");
          return;
        }

        case "status": {
          if (!session.conn || !session.system) {
            ctx.ui.notify("Not connected. Use /ssh connect to connect.", "info");
            return;
          }
          ctx.ui.notify(
            `Connected to ${session.system.user}@${session.system.os} | pm: ${session.system.packageManager} | sudo: ${session.system.hasSudo}`,
            "info",
          );
          return;
        }

        default:
          ctx.ui.notify("Usage: /ssh connect|disconnect|status", "error");
      }
    },
  });

  // Keyboard shortcuts for the SSH output panel
  // Note: pi-tui widgets don't receive focus, so we use registered
  // shortcuts instead of inline handleInput. These keys avoid conflicts
  // with pi's built-in bindings (see keybindings.md).
  pi.registerShortcut("ctrl+q", {
    description: "Toggle SSH output panel",
    handler: async (ctx: ExtensionContext) => {
      session.ui.updateContext(ctx);
      session.ui.togglePanel();
    },
  });

  pi.registerShortcut("alt+k", {
    description: "SSH panel: scroll up",
    handler: async (ctx: ExtensionContext) => {
      session.ui.updateContext(ctx);
      session.ui.scrollUp();
    },
  });

  pi.registerShortcut("alt+j", {
    description: "SSH panel: scroll down",
    handler: async (ctx: ExtensionContext) => {
      session.ui.updateContext(ctx);
      session.ui.scrollDown();
    },
  });

  pi.registerShortcut("alt+g", {
    description: "SSH panel: scroll to bottom",
    handler: async (ctx: ExtensionContext) => {
      session.ui.updateContext(ctx);
      session.ui.scrollToBottom();
    },
  });

  pi.registerShortcut("alt+l", {
    description: "SSH panel: clear output",
    handler: async (ctx: ExtensionContext) => {
      session.ui.updateContext(ctx);
      session.ui.clearPanel();
    },
  });

  // Route !commands through SSH when connected
  pi.on("user_bash", (event, _ctx: ExtensionContext) => {
    if (!session.conn?.isConnected) return;
    return {
      operations: {
        async exec(command: string, _cwd: string, _options: any) {
          const result = await session.conn!.exec(command, 30000);
          return {
            output: (result.stdout + (result.stderr ? "\n" + result.stderr : "")).trim(),
            exitCode: result.exitCode,
            cancelled: false,
            truncated: result.stdout.length >= 8000,
          };
        },
      },
    };
  });

  // Keep ctx fresh on every agent start
  pi.on("agent_start", async (_event: any, ctx: ExtensionContext) => {
    session.ui.updateContext(ctx);
  });

  pi.on("session_shutdown", async () => {
    if (session.conn) {
      session.disconnect();
    }
  });
}
