use crate::epg::{self, EpgChannelWithPrograms, Program};

#[tauri::command]
pub async fn fetch_epg(url: Vec<String>) -> Result<(), String> {
    for single_url in url {
        epg::fetch_and_parse_epg(single_url)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_channel_programs(channel_id: String) -> Result<Vec<Program>, String> {
    epg::get_programs_by_channel(channel_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_epg_by_range(
    start_time: String,
    end_time: String,
    skip: usize,
    limit: usize,
    playlist_channel_names: Vec<String>,
) -> Result<Vec<EpgChannelWithPrograms>, String> {
    epg::get_epg_by_range(start_time, end_time, skip, limit, playlist_channel_names)
        .await
        .map_err(|e| e.to_string())
}
