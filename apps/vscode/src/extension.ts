/**
 * The VS Code shell: one command, one custom editor.
 *
 * `Prompt Burn: Open Dashboard` opens a tab in the **editor area**, at full
 * editor width, the way opening a file does — not a sidebar view and not a
 * panel. That is why this is a custom editor for a virtual URI rather than a
 * `createWebviewPanel` call: the tab is a real editor input, so it moves,
 * splits and restores like any other tab, and running the command again reveals
 * the existing tab instead of stacking duplicates.
 *
 * The webview is registered with `retainContextWhenHidden`, so switching to
 * another tab and back does not tear down and rebuild it. Content is a
 * placeholder line for now; commit 26 gives the host a `UsageReader` and commit
 * 27 puts the `@prompt-burn/ui` bundle in here.
 */

import * as vscode from "vscode";
import {
  COMMAND_OPEN,
  DASHBOARD_PATH,
  DASHBOARD_SCHEME,
  TAB_TITLE,
  VIEW_TYPE,
} from "./ids.js";

const dashboardUri = vscode.Uri.from({ scheme: DASHBOARD_SCHEME, path: DASHBOARD_PATH });

/**
 * Read-only because nothing here is editable: no save, no dirty state, no
 * backups. The document is only the tab's identity; it holds no content.
 */
class DashboardEditorProvider implements vscode.CustomReadonlyEditorProvider {
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(_document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    // Scripts stay off until there is a bundle to run (commit 27).
    panel.webview.options = { enableScripts: false };
    panel.webview.html = placeholderHtml();
  }
}

function placeholderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
    <title>${TAB_TITLE}</title>
  </head>
  <body style="font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 2rem">
    <h1>${TAB_TITLE}</h1>
    <p>The dashboard will render here.</p>
  </body>
</html>
`;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DashboardEditorProvider(), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand(COMMAND_OPEN, () =>
      vscode.commands.executeCommand("vscode.openWith", dashboardUri, VIEW_TYPE),
    ),
  );
}

export function deactivate(): void {}
