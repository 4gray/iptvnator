use log::info;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::Runtime;

#[derive(Debug, Serialize, Clone)]
pub struct MpvProcess {
    id: u32,
    url: String,
    start_time: u64,
    last_known_time: Option<f64>,
    title: String,
    thumbnail: Option<String>,
}

static MPV_PROCESSES: Lazy<Mutex<HashMap<u32, MpvProcess>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn open_in_mpv<R: Runtime>(
    url: String,
    path: String,
    title: String,
    thumbnail: Option<String>,
    user_agent: Option<String>,
    referer: Option<String>,
    origin: Option<String>,
    app_handle: tauri::AppHandle<R>,
) -> Result<u32, String> {
    info!("Custom MVP path: {}", path);
    let mpv_paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\mpv\mpv.exe",
            r"C:\Program Files (x86)\mpv\mpv.exe",
        ]
    } else if cfg!(target_os = "linux") {
        vec!["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv"]
    } else {
        vec![
            "/Applications/mpv.app/Contents/MacOS/mpv",
            "/opt/homebrew/bin/mpv",
            "/usr/local/bin/mpv",
        ]
    };

    let mpv_path = if !path.is_empty() && Path::new(&path).exists() {
        path
    } else {
        mpv_paths
            .iter()
            .find(|&path| Path::new(path).exists())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "mpv".to_string())
    };

    info!("Using the following MPV player path: {}", mpv_path);

    // Add --input-ipc-server for IPC communication
    let ipc_socket = format!(
        "/tmp/mpv-socket-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    );

    let mut command = Command::new(mpv_path.clone());
    command.arg(format!("--input-ipc-server={}", ipc_socket));
    
    // Add headers if they are provided
    if let Some(ua) = user_agent {
        if !ua.is_empty() {
            command.arg(format!("--user-agent={}", ua));
        }
    }

    if let Some(ref_url) = referer {
        if !ref_url.is_empty() {
            command.arg(format!("--referrer={}", ref_url));
        }
    }

    if let Some(origin_url) = origin {
        if !origin_url.is_empty() {
            command.arg(format!("--http-header-fields=Origin: {}", origin_url));
        }
    }

    command.arg(&url);

    // Log the complete command line
    let command_str = format!(
        "{} {}",
        mpv_path,
        command
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    );
    info!("Complete MPV command: {}", command_str);

    let child = command.spawn().map_err(|e| e.to_string())?;

    let process_id = child.id();

    // Clone app_handle for the monitoring thread
    let app_handle_clone = app_handle.clone();

    // Spawn a thread to monitor the process
    thread::spawn(move || {
        let _ = child.wait_with_output(); // Wait for the process to exit

        // Process has exited, remove it from our map and notify frontend
        if let Some(process) = MPV_PROCESSES.lock().unwrap().remove(&process_id) {
            let _ = app_handle_clone.emit("mpv-process-removed", process);
        }
    });

    // Store process information
    let mpv_process = MpvProcess {
        id: process_id,
        url: url.clone(),
        start_time: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        last_known_time: None,
        title,
        thumbnail,
    };

    MPV_PROCESSES
        .lock()
        .unwrap()
        .insert(process_id, mpv_process.clone());

    // Updated event emission
    app_handle
        .emit("mpv-process-added", mpv_process)
        .map_err(|e| e.to_string())?;

    Ok(process_id)
}

#[tauri::command]
pub async fn get_active_mpv_processes() -> Vec<MpvProcess> {
    MPV_PROCESSES.lock().unwrap().values().cloned().collect()
}

#[tauri::command]
pub async fn close_mpv_process<R: Runtime>(
    process_id: u32,
    app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    #[cfg(windows)]
    return Err("Process termination is not supported on Windows".to_string());
    if let Some(process) = MPV_PROCESSES.lock().unwrap().remove(&process_id) {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(process_id as i32, libc::SIGTERM);
            }
        }

        // Updated event emission
        app_handle
            .emit("mpv-process-removed", process)
            .map_err(|e| e.to_string())?;

        Ok(())
    } else {
        Err("Process not found".to_string())
    }
}

#[tauri::command]
pub async fn open_in_vlc<R: Runtime>(
    url: String,
    path: String,
    _app_handle: tauri::AppHandle<R>,
) -> Result<(), String> {
    info!("Custom MVP path: {}", path);
    let vlc_paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\VideoLAN\VLC\vlc.exe",
            r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
        ]
    } else if cfg!(target_os = "linux") {
        vec!["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"]
    } else {
        vec![
            "/Applications/VLC.app/Contents/MacOS/VLC",
            "/opt/homebrew/bin/vlc",
            "/usr/local/bin/vlc",
        ]
    };

    let vlc_path = if !path.is_empty() && Path::new(&path).exists() {
        path
    } else {
        vlc_paths
            .iter()
            .find(|&path| Path::new(path).exists())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "vlc".to_string())
    };

    info!("Using VLC player path: {}", vlc_path);

    Command::new(vlc_path)
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

