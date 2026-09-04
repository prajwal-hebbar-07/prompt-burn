// Keep the release build from opening a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::path::BaseDirectory;
use tauri::Manager;

/// The sidecar's pipes behind one lock: the protocol is newline JSON on a
/// single stdio pair, so requests are answered strictly in order.
struct SidecarPipes {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// The Node sidecar, kept alive for the lifetime of the app.
///
/// Rust owns the window and relays bytes; SQLite and the collectors are
/// TypeScript, shared verbatim with the VS Code host. Holding the child here
/// also holds its stdin pipe open — dropping this on exit closes the pipe and
/// the sidecar shuts itself down.
struct Sidecar {
    #[allow(dead_code)]
    child: Child,
    pipes: Arc<Mutex<SidecarPipes>>,
}

/// A sidecar, or the reason there isn't one. Never a panic: an app that cannot
/// start its sidecar still opens its window and says why.
type SidecarState = Result<Sidecar, String>;

/// `node:sqlite` — the sidecar's whole database layer — needs a modern Node,
/// and the workspace pins the same floor in `engines.node`.
const MIN_NODE_MAJOR: u32 = 24;

/// Interpreters outside any version manager, newest-first is not a thing here.
const SYSTEM_NODES: [&str; 3] = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
];

/// The major version `node` reports, or `None` when it will not run at all.
fn node_major(node: &Path) -> Option<u32> {
    let output = Command::new(node).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    // `v26.8.1` -> 26
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// `v26.8.1` as a sortable tuple; anything unparsable sorts to the bottom.
fn version_key(path: &Path) -> (u32, u32, u32) {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let mut parts = name
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// Asks the user's shell where `node` is.
///
/// `-l` alone is not enough: zsh reads `.zprofile` for a login shell but
/// `.zshrc` only for an interactive one, and nvm initialises in `.zshrc`. The
/// probe therefore runs login *and* interactive, with stdin closed so an rc
/// file that reads input cannot hang the launch. An interactive rc may print
/// banners, so the answer is the last line that looks like a path.
fn shell_node() -> Option<PathBuf> {
    let shell = env::var("SHELL").ok()?;
    let output = Command::new(shell)
        .args(["-l", "-i", "-c", "command -v node"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        .next_back()
        .map(PathBuf::from)
}

/// Every Node a version manager has installed, newest version first.
///
/// nvm and fnm keep one directory per version; Volta and asdf publish a shim.
/// Reading the directories directly is what makes discovery work when the
/// shell probe cannot run at all (no `SHELL`, an rc that fails, Windows).
fn version_manager_nodes() -> Vec<PathBuf> {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let mut found = Vec::new();

    for (root, suffix) in [
        (home.join(".nvm/versions/node"), "bin/node"),
        (
            home.join(".local/share/fnm/node-versions"),
            "installation/bin/node",
        ),
        (
            home.join("Library/Application Support/fnm/node-versions"),
            "installation/bin/node",
        ),
    ] {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        let mut versions: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        versions.sort_by_key(|path| std::cmp::Reverse(version_key(path)));
        found.extend(versions.into_iter().map(|version| version.join(suffix)));
    }

    found.push(home.join(".volta/bin/node"));
    found.push(home.join(".asdf/shims/node"));
    found
}

/// Finds the Node interpreter to run the sidecar with.
///
/// An app launched from Finder or the Dock inherits launchd's `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), not the shell's — so a Node installed by
/// nvm, fnm, asdf, Volta or Homebrew is invisible to a bare `Command::new`,
/// which is exactly why the packaged app failed while `tauri dev` worked. Every
/// candidate is version-checked rather than trusted: an ancient
/// `/usr/local/bin/node` must not win over the nvm one that can actually run
/// `node:sqlite`.
fn node_binary() -> Result<PathBuf, String> {
    let candidates = [PathBuf::from("node")]
        .into_iter()
        .chain(shell_node())
        .chain(version_manager_nodes())
        .chain(SYSTEM_NODES.iter().map(PathBuf::from));

    let mut too_old: Option<(PathBuf, u32)> = None;
    for candidate in candidates {
        match node_major(&candidate) {
            Some(major) if major >= MIN_NODE_MAJOR => return Ok(candidate),
            Some(major) => {
                if too_old.as_ref().map_or(true, |(_, best)| major > *best) {
                    too_old = Some((candidate, major));
                }
            }
            None => {}
        }
    }

    Err(match too_old {
        Some((path, major)) => format!(
            "Prompt Burn needs Node {MIN_NODE_MAJOR} or newer. The newest one on this machine is v{major} ({}). Install a current Node from nodejs.org, then reopen Prompt Burn.",
            path.display()
        ),
        None => format!(
            "Node {MIN_NODE_MAJOR} or newer is required and could not be found. Install it from nodejs.org, then reopen Prompt Burn."
        ),
    })
}

/// The arguments that point Node at the sidecar.
///
/// A debug build runs the workspace source, TypeScript and all. A packaged app
/// runs `sidecar.mjs`, the Vite-bundled sidecar with the workspace packages
/// inlined, carried as a Tauri resource: `CARGO_MANIFEST_DIR` is a path on the
/// machine that built the app and exists nowhere else.
fn sidecar_arguments(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    if cfg!(debug_assertions) {
        let app_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        return Ok(vec![
            PathBuf::from("--import"),
            app_dir.join("sidecar/ts-resolve.mjs"),
            app_dir.join("sidecar/index.ts"),
        ]);
    }

    let script = app
        .path()
        .resolve("sidecar.mjs", BaseDirectory::Resource)
        .map_err(|error| format!("could not resolve the bundled sidecar: {error}"))?;
    if !script.exists() {
        return Err(format!(
            "the bundled sidecar is missing from this build: {}",
            script.display()
        ));
    }
    Ok(vec![script])
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<Sidecar, String> {
    let node = node_binary()?;
    let mut child = Command::new(&node)
        .args(sidecar_arguments(app)?)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start `{}`: {error}", node.display()))?;

    let stdin = child.stdin.take().expect("stdin was piped");
    let stdout = BufReader::new(child.stdout.take().expect("stdout was piped"));

    Ok(Sidecar {
        child,
        pipes: Arc::new(Mutex::new(SidecarPipes { stdin, stdout })),
    })
}

/// Relays one protocol line to the sidecar and returns its response line.
///
/// Rust stays a dumb pipe on purpose: request and response shapes live in
/// TypeScript on both ends (`sidecar/index.ts` and the webview), so there is no
/// second copy of the protocol here to drift out of step. Everything before the
/// response — the ready line, any logging — is printed, not returned.
#[tauri::command]
async fn sidecar_request(
    sidecar: tauri::State<'_, SidecarState>,
    request: String,
) -> Result<String, String> {
    if request.contains('\n') {
        return Err("a sidecar request must be a single line".to_string());
    }
    // A startup failure is answered here, once per request, so the window can
    // show it in its own error banner.
    let pipes = match sidecar.inner() {
        Ok(sidecar) => Arc::clone(&sidecar.pipes),
        Err(error) => return Err(error.clone()),
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut pipes = pipes
            .lock()
            .map_err(|_| "the sidecar lock is poisoned".to_string())?;
        let SidecarPipes { stdin, stdout } = &mut *pipes;

        writeln!(stdin, "{request}").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())?;

        loop {
            let mut line = String::new();
            if stdout
                .read_line(&mut line)
                .map_err(|error| error.to_string())?
                == 0
            {
                return Err("the sidecar closed its stdout".to_string());
            }
            if line.contains("\"type\":\"response\"") {
                return Ok(line.trim_end().to_string());
            }
            println!("[sidecar] {}", line.trim_end());
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // A sidecar that will not start must not take the window with it.
            // The failure is kept and returned from every request instead, so
            // the user reads the reason rather than watching the app quit.
            let sidecar: SidecarState =
                spawn_sidecar(app.handle()).inspect_err(|error| eprintln!("[sidecar] {error}"));
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_request])
        .run(tauri::generate_context!())
        .expect("could not run the Prompt Burn window");
}
