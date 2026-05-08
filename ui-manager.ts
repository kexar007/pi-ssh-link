import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SshPanel } from "./ssh-panel.js";
import type { SshProfile } from "./types.js";

export class UiManager {
  private panel = new SshPanel();
  private ctx: ExtensionContext | null = null;
  private panelVisible = true;

  updateContext(ctx: ExtensionContext): void {
    this.ctx = ctx;
    // Inject theme into panel whenever context updates
    if (ctx.ui?.theme) {
      this.panel.setTheme(ctx.ui.theme);
    }
  }

  onConnect(profile: SshProfile): void {
    this.panel.setConnected(profile);
    this.mountWidget();
    this.updateFooter();
  }

  onDisconnect(): void {
    this.panel.setDisconnected();
    this.ctx?.ui.setWidget("ssh-panel", undefined);
    this.ctx?.ui.setStatus("ssh-link", undefined);
  }

  onOutput(text: string): void {
    this.panel.write(text);
  }

  onExitCode(code: number): void {
    this.panel.setExitCode(code);
  }

  togglePanel(): void {
    this.panelVisible = !this.panelVisible;
    if (this.panelVisible) {
      this.mountWidget();
    } else {
      this.ctx?.ui.setWidget("ssh-panel", undefined);
    }
  }

  private mountWidget(): void {
    if (!this.ctx || !this.panelVisible) return;
    const panel = this.panel;

    this.ctx.ui.setWidget("ssh-panel", (tui, theme) => {
      panel.setTheme(theme);
      return {
        render: (w: number) => panel.render(w),
        invalidate: () => panel.invalidate(),
        handleInput: (data: string) => { panel.handleInput(data); tui.requestRender(); },
      };
    });
  }

  private updateFooter(): void {
    if (!this.ctx) return;
    const theme = this.ctx.ui?.theme;
    if (!theme) return;
    this.ctx.ui.setStatus(
      "ssh-link",
      theme.fg("success", "● SSH connected") +
      theme.fg("dim", "  ctrl+shift+s: toggle panel")
    );
  }
}
