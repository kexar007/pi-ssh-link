import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SshSession } from "./session.js";
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
      command: Type.String({ description: "Shell command to execute on the remote server" }),
      timeout_seconds: Type.Optional(
        Type.Number({ default: 30, description: "Timeout in seconds" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx: ExtensionContext) {
      guard();
      try {
        const res = await session.conn!.exec(params.command, (params.timeout_seconds ?? 30) * 1000);
        return {
          content: [{ type: "text" as const, text: truncateOutput(formatResult(res)) }],
          details: { exitCode: res.exitCode },
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: e.message }],
          isError: true,
          details: {},
        };
      }
    },
  });

  pi.registerTool({
    name: "ssh_read",
    label: "SSH Read",
    description: "Read a file from the remote server via SSH. Use max_lines for large files.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path to the file on the remote server" }),
      max_lines: Type.Optional(
        Type.Number({ description: "Maximum number of lines to read (uses head -n)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx: ExtensionContext) {
      guard();
      const cmd = params.max_lines
        ? `head -n ${params.max_lines} ${sq(params.path)}`
        : `cat ${sq(params.path)}`;
      const res = await session.conn!.exec(cmd);
      return {
        content: [{ type: "text" as const, text: truncateOutput(res.stdout) }],
        details: { exitCode: res.exitCode },
      };
    },
  });

  pi.registerTool({
    name: "ssh_write",
    label: "SSH Write",
    description:
      "Write content to a file on the remote server. Uses safe Base64 chunked transfer to avoid escaping issues.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path to the file on the remote server" }),
      content: Type.String({ description: "Content to write to the file" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx: ExtensionContext) {
      guard();
      const b64 = Buffer.from(params.content).toString("base64");
      const chunks = b64.match(/.{1,32000}/g) || [];
      const sPath = sq(params.path);
      await session.conn!.exec(`mkdir -p "$(dirname ${sPath})" && > ${sPath}.b64`);
      for (const chunk of chunks) {
        await session.conn!.exec(`echo -n ${sq(chunk)} >> ${sPath}.b64`);
      }
      await session.conn!.exec(`base64 -d < ${sPath}.b64 > ${sPath} && rm ${sPath}.b64`);
      return {
        content: [{ type: "text" as const, text: `Written to ${params.path}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ssh_edit",
    label: "SSH Edit",
    description:
      "Surgical string replacement in a remote file. Only edits if old_str is found exactly once.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path to the file on the remote server" }),
      old_str: Type.String({ description: "Exact text to replace" }),
      new_str: Type.String({ description: "Replacement text" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx: ExtensionContext) {
      guard();
      const res = await session.conn!.exec(`base64 ${sq(params.path)}`);
      const content = Buffer.from(res.stdout, "base64").toString("utf8");
      if (!content.includes(params.old_str)) {
        return {
          content: [{ type: "text" as const, text: "Error: old_str not found in file." }],
          details: {},
        };
      }
      const newContent = content.replace(params.old_str, params.new_str);
      const b64 = Buffer.from(newContent).toString("base64");
      await session.conn!.exec(`echo ${sq(b64)} | base64 -d > ${sq(params.path)}`);
      return {
        content: [{ type: "text" as const, text: `Edited ${params.path}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ssh_detect_system",
    label: "SSH Detect System",
    description:
      "Get structured OS, user, package manager, and privilege info from the remote server.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx: ExtensionContext) {
      guard();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(session.system, null, 2),
          },
        ],
        details: {},
      };
    },
  });
}
