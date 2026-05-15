import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SshSession } from "./session.js";
import { detectSystem } from "./system-detect.js";
import { truncateOutput, formatResult } from "./utils.js";

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function registerTools(pi: ExtensionAPI, session: SshSession) {
  const guard = () => {
    if (!session.conn)
      throw new Error("Not connected to any server. Use /ssh connect first.");
  };

  pi.registerTool({
    name: "ssh_bash",
    label: "SSH Bash",
    description:
      "Run a shell command on the remote server via persistent SSH session. cd state and exported env vars persist across calls.",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to execute on the remote server",
      }),
      timeout_seconds: Type.Optional(
        Type.Number({ default: 30, description: "Timeout in seconds" }),
      ),
    }),
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      guard();
      try {
        const res = await session.conn!.exec(
          params.command,
          (params.timeout_seconds ?? 30) * 1000,
        );
        return {
          content: [
            { type: "text" as const, text: truncateOutput(formatResult(res)) },
          ],
          details: {
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
          },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
          details: {},
        };
      }
    },
    renderCall(args: any, theme: any, _ctx: any) {
      const label = theme.fg("toolTitle", theme.bold("ssh $ "));
      const cmd = theme.fg("accent", args.command ?? "");
      return new Text(label + cmd, 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial) return new Text(theme.fg("dim", "running…"), 0, 0);
      const exitCode = result.details?.exitCode ?? 0;
      const exitColor = exitCode === 0 ? "success" : "error";
      const exitLabel = theme.fg(exitColor, `[exit ${exitCode}]`);
      const stdout = (result.details?.stdout ?? result.content ?? "").trim();
      const body = stdout ? "\n" + theme.fg("dim", stdout) : "";
      return new Text(exitLabel + body, 0, 0);
    },
  });

  pi.registerTool({
    name: "ssh_read",
    label: "SSH Read",
    description:
      "Read a file from the remote server via SSH. Use max_lines for large files.",
    promptSnippet: "Use this for all remote file ops when connected",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path to the file on the remote server",
      }),
      max_lines: Type.Optional(
        Type.Number({
          description: "Maximum number of lines to read (uses head -n)",
        }),
      ),
    }),
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      guard();
      try {
        const cmd = params.max_lines
          ? `head -n ${params.max_lines} ${sq(params.path)}`
          : `cat ${sq(params.path)}`;
        const res = await session.conn!.rawExec(cmd);
        return {
          content: [
            { type: "text" as const, text: truncateOutput(res.stdout) },
          ],
          details: {
            path: params.path,
            content: res.stdout,
          },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
          details: {},
        };
      }
    },
    renderCall(args: any, theme: any, _ctx: any) {
      const label = theme.fg("toolTitle", theme.bold("ssh read "));
      const path = theme.fg("accent", args.path ?? "");
      return new Text(label + path, 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial) return new Text(theme.fg("dim", "reading…"), 0, 0);
      const text = result.details?.content ?? "";
      const lines = text.split("\n").length;
      const summary = theme.fg("success", `✓ ${lines} lines`);
      if (!options.expanded) return new Text(summary, 0, 0);
      return new Text(summary + "\n" + theme.fg("dim", text), 0, 0);
    },
  });

  pi.registerTool({
    name: "ssh_write",
    label: "SSH Write",
    description:
      "Write content to a file on the remote server. Uses safe Base64 chunked transfer to avoid escaping issues.",
    promptSnippet: "Use this for all remote file ops when connected",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path to the file on the remote server",
      }),
      content: Type.String({ description: "Content to write to the file" }),
    }),
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      guard();
      try {
        const b64 = Buffer.from(params.content).toString("base64");
        const chunks = b64.match(/.{1,32000}/g) || [];
        const sPath = sq(params.path);
        // Atomic write: write to a temp file first, then mv to final destination
        await session.conn!.exec(`mkdir -p "$(dirname ${sPath})"`);
        await session.conn!.exec(`tmp=$(mktemp) && > "$tmp".b64`);
        for (const chunk of chunks) {
          await session.conn!.exec(`echo -n ${sq(chunk)} >> "$tmp".b64`);
        }
        await session.conn!.exec(
          `base64 -d < "$tmp".b64 > "$tmp" && mv "$tmp" ${sPath} && rm -f "$tmp".b64`,
        );
        return {
          content: [
            { type: "text" as const, text: `Written to ${params.path}` },
          ],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
          details: {},
        };
      }
    },
    renderCall(args: any, theme: any, _ctx: any) {
      const label = theme.fg("toolTitle", theme.bold("ssh write "));
      const path = theme.fg("accent", args.path ?? "");
      const size = args.content
        ? theme.fg("dim", ` (${args.content.length} bytes)`)
        : "";
      return new Text(label + path + size, 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial) return new Text(theme.fg("dim", "writing…"), 0, 0);
      return new Text(theme.fg("success", "✓ written"), 0, 0);
    },
  });

  pi.registerTool({
    name: "ssh_edit",
    label: "SSH Edit",
    description:
      "Surgical string replacement in a remote file. Only edits if old_str is found exactly once.",
    promptSnippet: "Use this for all remote file ops when connected",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path to the file on the remote server",
      }),
      old_str: Type.String({ description: "Exact text to replace" }),
      new_str: Type.String({ description: "Replacement text" }),
    }),
    async execute(
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      guard();
      try {
        const res = await session.conn!.exec(`base64 ${sq(params.path)}`);
        const content = Buffer.from(res.stdout, "base64").toString("utf8");
        const occurrences = content.split(params.old_str).length - 1;

        if (occurrences === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: old_str not found in file.",
              },
            ],
            details: {},
          };
        }

        if (occurrences > 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: old_str found ${occurrences} times. Make it more specific so it matches exactly once.`,
              },
            ],
            details: {},
          };
        }
        const newContent = content.replace(params.old_str, params.new_str);
        const b64 = Buffer.from(newContent).toString("base64");
        await session.conn!.exec(
          `echo ${sq(b64)} | base64 -d > ${sq(params.path)}`,
        );
        return {
          content: [{ type: "text" as const, text: `Edited ${params.path}` }],
          details: {},
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
          details: {},
        };
      }
    },
    renderCall(args: any, theme: any, _ctx: any) {
      const label = theme.fg("toolTitle", theme.bold("ssh edit "));
      const path = theme.fg("accent", args.path ?? "");
      return new Text(label + path, 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial) return new Text(theme.fg("dim", "editing…"), 0, 0);
      return new Text(theme.fg("success", "✓ patched"), 0, 0);
    },
  });

  pi.registerTool({
    name: "ssh_detect_system",
    label: "SSH Detect System",
    description:
      "Re-run OS, user, package manager, and privilege detection on the remote server. " +
      "Use this if the environment may have changed since connecting (e.g. new software installed).",
    parameters: Type.Object({}),
    async execute(
      _toolCallId,
      _params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      guard();
      try {
        session.system = await detectSystem(session.conn!);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(session.system, null, 2),
            },
          ],
          details: { system: session.system },
        };
      } catch (e: any) {
        return {
          content: [
            { type: "text" as const, text: `Detection failed: ${e.message}` },
          ],
          isError: true,
          details: {},
        };
      }
    },
    renderCall(_args: any, theme: any, _ctx: any) {
      return new Text(theme.fg("toolTitle", theme.bold("ssh re-detect")), 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial)
        return new Text(theme.fg("dim", "detecting…"), 0, 0);
      try {
        const info =
          result.details?.system ?? JSON.parse(result.content ?? "{}");
        const text =
          theme.fg("success", "✓ ") +
          theme.fg("accent", info.os ?? "?") +
          " " +
          theme.fg("dim", info.packageManager ?? "") +
          " " +
          theme.fg("muted", info.user ?? "");
        return new Text(text, 0, 0);
      } catch {
        return new Text(theme.fg("success", "✓ detected"), 0, 0);
      }
    },
  });

  pi.registerTool({
    name: "ssh_status",
    label: "SSH Status",
    description: "Returns the current SSH connection status",
    parameters: Type.Object({}),
    async execute(
      _toolCallId,
      _params,
      _signal,
      _onUpdate,
      _ctx: ExtensionContext,
    ) {
      if (!session.conn) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { status: "disconnected", reconnectAttempts: 0 },
                null,
                2,
              ),
            },
          ],
          details: {},
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: session.conn.getStatus(),
                reconnectAttempts: session.conn.reconnectAttempts,
              },
              null,
              2,
            ),
          },
        ],
        details: {},
      };
    },
    renderCall(_args: any, theme: any, _ctx: any) {
      return new Text(theme.fg("toolTitle", theme.bold("ssh status")), 0, 0);
    },
    renderResult(result: any, options: any, theme: any, _ctx: any) {
      if (options.isPartial)
        return new Text(theme.fg("dim", "checking…"), 0, 0);
      try {
        const info = JSON.parse(
          Array.isArray(result.content)
            ? result.content.map((c: any) => c.text ?? "").join("")
            : (result.content ?? "{}"),
        );
        const statusColor = info.status === "connected" ? "success" : "error";
        const statusText = theme.fg(statusColor, info.status ?? "unknown");
        const reconnects =
          info.reconnectAttempts > 0
            ? theme.fg("warning", ` (reconnects: ${info.reconnectAttempts})`)
            : "";
        return new Text(statusText + reconnects, 0, 0);
      } catch {
        return new Text(theme.fg("success", "✓ ok"), 0, 0);
      }
    },
  });
}
