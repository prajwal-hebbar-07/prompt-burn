// Keep the release build from opening a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

/// The Node sidecar, kept alive for the lifetime of the app.
///
/// Rust owns the window and nothing else: SQLite and the collectors are
/// TypeScript, shared verbatim with the VS Code host. Holding the child here
/// also holds its stdin pipe open — dropping this on exit closes the pipe and
/// the sidecar shuts itself down.
struct Sidecar(#[allow(dead_code)] Child);

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

    // Its stdout is the proof the database opened; the request protocol that
    // replaces this reader arrives with UsageReader.
    let stdout = child.stdout.take().expect("stdout was piped");
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("[sidecar] {line}");
        }
    });

    Ok(Sidecar(child))
}

fn main() {
    let sidecar = spawn_sidecar().expect("could not start the Node sidecar (is `node` on PATH?)");

    tauri::Builder::default()
        .manage(sidecar)
        .run(tauri::generate_context!())
        .expect("could not run the Prompt Burn window");
}
