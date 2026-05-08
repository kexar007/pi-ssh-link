import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SshPanel } from "./ssh-panel.js";
import type { SshProfile, SystemInfo } from "./types.js";

export class UiManager {
  private panel = new SshPanel();
  private ctx: ExtensionContext | null = null;
  private tui: any = null;
  private panelVisible = true;

  updateContext(ctx: ExtensionContext): void {
    this.ctx = ctx;
    // Inject theme into panel whenever context updates
    if (ctx.ui?.theme) {
      this.panel.setTheme(ctx.ui.theme);
    }
  }

  setConnecting(profile: SshProfile): void {
    this.panel.setConnecting(profile);
    this.mountWidget();
  }

  setSystemInfo(info: SystemInfo): void {
    this.panel.setSystemInfo(info);
    this.tui?.requestRender();
  }

  onConnect(profile: SshProfile): void {
    this.panel.markConnected(profile);
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
    this.tui?.requestRender();
  }

  onExitCode(code: number): void {
    this.panel.setExitCode(code);
    this.tui?.requestRender();
  }

  togglePanel(): void {
    this.panelVisible = !this.panelVisible;
    if (this.panelVisible) {
      this.mountWidget();
      this.ctx?.ui.notify("SSH panel shown", "info");
    } else {
      this.ctx?.ui.setWidget("ssh-panel", undefined);
      this.ctx?.ui.notify("SSH panel hidden", "info");
    }
  }

  scrollUp(): void {
    this.panel.scrollUp();
    this.tui?.requestRender();
  }

  scrollDown(): void {
    this.panel.scrollDown();
    this.tui?.requestRender();
  }

  scrollToBottom(): void {
    this.panel.scrollToBottom();
    this.tui?.requestRender();
  }

  clearPanel(): void {
    this.panel.clearPanel();
    this.tui?.requestRender();
  }

  private mountWidget(): void {
    if (!this.ctx || !this.panelVisible) return;
    const panel = this.panel;

    this.ctx.ui.setWidget("ssh-panel", (tui, theme) => {
      this.tui = tui;
      panel.setTheme(theme);
      return {
        render: (w: number) => panel.render(w),
        invalidate: () => panel.invalidate(),
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
      theme.fg("dim", "  Ctrl+Q toggle  Ctrl+Shift+↑↓ scroll  Ctrl+Shift+L clear")
    );
  }
}
