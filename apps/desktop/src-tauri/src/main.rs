// Keep the release build from opening a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

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

/// ponytail: dev layout — the sidecar runs from source next to this crate. A
/// packaged app will carry a bundled sidecar instead; that lands with
/// distribution, not with the shell.
fn sidecar_command() -> Command {
    let app = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut command = Command::new("node");
    command
        .arg("--import")
        .arg(app.join("sidecar/ts-resolve.mjs"))
        .arg(app.join("sidecar/index.ts"));
    command
}

fn spawn_sidecar() -> std::io::Result<Sidecar> {
    let mut child = sidecar_command()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

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
    sidecar: tauri::State<'_, Sidecar>,
    request: String,
) -> Result<String, String> {
    if request.contains('\n') {
        return Err("a sidecar request must be a single line".to_string());
    }
    let pipes = Arc::clone(&sidecar.pipes);

    tauri::async_runtime::spawn_blocking(move || {
        let mut pipes = pipes
            .lock()
            .map_err(|_| "the sidecar lock is poisoned".to_string())?;
        let SidecarPipes { stdin, stdout } = &mut *pipes;

        writeln!(stdin, "{request}").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())?;

        loop {
            let mut line = String::new();
            if stdout.read_line(&mut line).map_err(|error| error.to_string())? == 0 {
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
    let sidecar = spawn_sidecar().expect("could not start the Node sidecar (is `node` on PATH?)");

    tauri::Builder::default()
        .manage(sidecar)
        .invoke_handler(tauri::generate_handler![sidecar_request])
        .run(tauri::generate_context!())
        .expect("could not run the Prompt Burn window");
}