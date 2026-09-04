/**
 * The VS Code shell: one command, one custom editor, one webview bundle.
 *
 * `Prompt Burn: Open Dashboard` opens a tab in the **editor area**, at full
 * editor width, the way opening a file does — not a sidebar view and not a
 * panel. That is why this is a custom editor for a virtual URI rather than a
 * `createWebviewPanel` call: the tab is a real editor input, so it moves,
 * splits and restores like any other tab, and running the command again reveals
 * the existing tab instead of stacking duplicates.
 *
 * The tab renders the same `@prompt-burn/ui` bundle the desktop window does.
 * The webview never touches sqlite, the collectors or the network: it asks this
 * host over `postMessage` and gets a `DashboardSnapshot` back. The reader is
 * created once, lazily, so the shared database is opened when a tab is first
 * opened rather than at startup.
 *
 * `retainContextWhenHidden` keeps the webview — and with it the snapshot on
 * screen — alive while another tab is in front.
 */

import * as vscode from "vscode";
import type { UsageReader } from "@prompt-burn/reader";
import { respond } from "./host-messages.js";
import {
  COMMAND_OPEN,
  DASHBOARD_PATH,
  DASHBOARD_SCHEME,
  TAB_TITLE,
  VIEW_TYPE,
} from "./ids.js";
import { createHostReader } from "./reader.js";

const dashboardUri = vscode.Uri.from({ scheme: DASHBOARD_SCHEME, path: DASHBOARD_PATH });

/** Vite writes these names for us; see `vite.config.ts`. */
const BUNDLE_DIRECTORY = "dist";
const BUNDLE = "webview.js";
const STYLES = "webview.css";

/**
 * Read-only because nothing here is editable: no save, no dirty state, no
 * backups. The document is only the tab's identity; it holds no content.
 */
class DashboardEditorProvider implements vscode.CustomReadonlyEditorProvider {
  #reader: UsageReader | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = {
      enableScripts: true,
      // The bundle is the only thing the tab may load from disk.
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, BUNDLE_DIRECTORY)],
    };
    panel.webview.html = dashboardHtml(panel.webview, this.extensionUri);

    const subscription = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      const response = await respond(this.reader(), message);
      void panel.webview.postMessage(response);
    });
    panel.onDidDispose(() => subscription.dispose());
  }

  /** One reader — and so one open database handle — for every tab. */
  private reader(): UsageReader {
    this.#reader ??= createHostReader();
    return this.#reader;
  }
}

function dashboardHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, BUNDLE_DIRECTORY, name));
  // Fresh per render: the CSP admits exactly this page's script tag.
  const nonce = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <link rel="stylesheet" href="${asset(STYLES)}" />
    <title>${TAB_TITLE}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${asset(BUNDLE)}"></script>
  </body>
</html>
`;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new DashboardEditorProvider(context.extensionUri),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand(COMMAND_OPEN, () =>
      vscode.commands.executeCommand("vscode.openWith", dashboardUri, VIEW_TYPE),
    ),
  );
}

export function deactivate(): void {}
