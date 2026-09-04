/**
 * The identifiers the manifest and the extension host have to agree on.
 *
 * They live here, free of any `vscode` import, so a plain unit test can hold
 * `package.json` against them: a renamed command or view type that only got
 * changed on one side is the kind of break you otherwise find by hand in a
 * running editor.
 */

/** Command that opens the dashboard tab. */
export const COMMAND_OPEN = "promptBurn.open";

/** Custom editor view type, registered in the editor area. */
export const VIEW_TYPE = "promptBurn.dashboard";

/**
 * The dashboard is not a file on disk, but a custom editor still opens a URI.
 * This scheme has no filesystem provider on purpose — the provider owns the
 * document, so nothing ever reads the path — and the last path segment is what
 * the tab is labelled with.
 */
export const DASHBOARD_SCHEME = "prompt-burn";
export const TAB_TITLE = "Prompt Burn";
export const DASHBOARD_PATH = `/${TAB_TITLE}`;
