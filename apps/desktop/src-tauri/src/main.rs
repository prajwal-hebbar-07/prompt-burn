// Keep the release build from opening a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
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

/// Node interpreters to try when `node` is not on the inherited `PATH`.
const NODE_FALLBACKS: [&str; 3] = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
];

/// Finds the Node interpreter to run the sidecar with.
///
/// An app launched from Finder or the Dock inherits launchd's `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), not the shell's — so a Node installed by
/// nvm, fnm, asdf, Volta or Homebrew is invisible to a bare `Command::new`,
/// which is exactly why the packaged app died on startup while `tauri dev`
/// worked. The login shell knows where it is, so ask it before giving up.
fn node_binary() -> Result<PathBuf, String> {
    let on_path = Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if on_path {
        return Ok(PathBuf::from("node"));
    }

    // `-l` sources the profile, so version managers are on the path by then.
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    if let Ok(output) = Command::new(shell)
        .args(["-lc", "command -v node"])
        .output()
    {
        let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !found.is_empty() {
            return Ok(PathBuf::from(found));
        }
    }

    for candidate in NODE_FALLBACKS {
        if Path::new(candidate).exists() {
            return Ok(PathBuf::from(candidate));
        }
    }

    Err("Node 24 or newer is required and could not be found. Install it from nodejs.org, then reopen Prompt Burn.".to_string())
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
