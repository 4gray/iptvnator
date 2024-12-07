use log::info;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub async fn open_in_mpv(url: String, path: String) -> Result<(), String> {
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

    Command::new(mpv_path)
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn open_in_vlc(url: String, path: String) -> Result<(), String> {
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
