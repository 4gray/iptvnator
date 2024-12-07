use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use log::{info, warn};
use quick_xml::de::from_str;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use tokio::sync::OnceCell;
use xmltv::Tv;

// Modified to store multiple EPG sources
#[derive(Debug)]
struct EpgStore {
    sources: Vec<EpgSource>,
}

#[derive(Debug)]
struct EpgSource {
    url: String,
    programs: HashMap<String, Vec<Program>>,
}

// Replace the static EPG_DATA with the new structure
static EPG_DATA: OnceCell<Mutex<Option<EpgStore>>> = OnceCell::const_new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Program {
    pub start: DateTime<Utc>,
    pub stop: DateTime<Utc>,
    pub title: String,
    pub desc: Option<String>,
    pub channel: String,
    pub category: Option<String>,
    pub icon: Option<String>,
    pub language: Option<String>,
}

fn parse_xmltv_datetime(datetime: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_str(datetime, "%Y%m%d%H%M%S %z")
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

pub async fn fetch_and_parse_epg(url: String) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting EPG fetch from URL: {}", url);

    let new_source = fetch_single_epg_source(url.clone()).await?;

    // Update EPG store
    match EPG_DATA.get() {
        Some(epg_data) => {
            let mut guard = epg_data.lock().unwrap();
            let store = guard.get_or_insert_with(|| EpgStore {
                sources: Vec::new(),
            });

            // Remove existing source with same URL if exists
            store.sources.retain(|source| source.url != url);
            // Add new source
            store.sources.push(new_source);
            info!("Updated EPG store for URL: {}", url);
        }
        None => {
            EPG_DATA
                .set(Mutex::new(Some(EpgStore {
                    sources: vec![new_source],
                })))
                .unwrap();
            info!("Created new EPG data store");
        }
    }

    Ok(())
}

// New helper function to fetch and parse a single EPG source
async fn fetch_single_epg_source(url: String) -> Result<EpgSource, Box<dyn std::error::Error>> {
    info!("Starting EPG fetch from URL: {}", url);

    // Fetch content
    let client = reqwest::Client::new();
    let content = if url.ends_with(".gz") {
        info!("Fetching and decompressing gzipped EPG data...");
        let bytes = client.get(&url).send().await?.bytes().await?;
        let mut decoder = GzDecoder::new(&bytes[..]);
        let mut string = String::new();
        decoder.read_to_string(&mut string)?;
        info!("Successfully decompressed EPG data");
        string
    } else {
        info!("Fetching EPG data...");
        client.get(&url).send().await?.text().await?
    };

    info!("Parsing EPG XML data...");
    let tv: Tv = from_str(&content)?;

    // Get channel name mapping
    let channel_names: HashMap<String, String> = tv
        .channels
        .into_iter()
        .filter_map(|channel| {
            channel
                .display_names
                .first()
                .map(|name| (channel.id, name.name.clone()))
        })
        .collect();

    info!("Converting EPG programs...");
    let programs: Vec<Program> = tv
        .programmes
        .into_iter()
        .filter_map(|p| {
            let channel_name = match channel_names.get(&p.channel) {
                Some(name) => name.clone(),
                None => {
                    warn!("No channel name found for id: {}", p.channel);
                    return None;
                }
            };

            let parse_datetime = |opt_str: &Option<String>| -> Option<DateTime<Utc>> {
                opt_str.as_deref().and_then(parse_xmltv_datetime)
            };

            let start = match parse_datetime(&Some(p.start)) {
                Some(dt) => dt,
                None => {
                    warn!(
                        "Invalid start time format for program in channel {}",
                        p.channel
                    );
                    return None;
                }
            };

            let stop = match parse_datetime(&p.stop) {
                Some(dt) => dt,
                None => {
                    warn!(
                        "Invalid stop time format for program in channel {}",
                        p.channel
                    );
                    return None;
                }
            };

            let title = match p.titles.first() {
                Some(t) => t.value.clone(),
                None => {
                    warn!("Program without title found in channel {}", p.channel);
                    return None;
                }
            };

            Some(Program {
                start,
                stop,
                title,
                desc: p.descriptions.first().map(|d| d.value.clone()),
                channel: channel_name,
                category: p.categories.first().map(|c| c.name.clone()),
                icon: p.icons.first().map(|i| i.src.clone()),
                language: p.language.map(|lang| lang.value),
            })
        })
        .collect();

    info!("Successfully parsed {} EPG programs", programs.len());

    // Group by channel
    let program_map = programs
        .into_iter()
        .fold(HashMap::new(), |mut acc, program| {
            acc.entry(program.channel.clone())
                .or_insert_with(Vec::new)
                .push(program);
            acc
        });

    info!("EPG data grouped into {} channels", program_map.len());

    Ok(EpgSource {
        url,
        programs: program_map,
    })
}

pub async fn get_programs_by_channel(
    channel_name: String,
) -> Result<Vec<Program>, Box<dyn std::error::Error>> {
    info!("Retrieving programs for channel name: {}", channel_name);

    let programs = match EPG_DATA.get() {
        Some(data) => {
            let guard = data.lock().unwrap();
            match &*guard {
                Some(store) => {
                    // Search through all sources and combine matches
                    let mut all_programs = Vec::new();
                    for source in &store.sources {
                        if let Some(programs) = source.programs.get(&channel_name) {
                            info!(
                                "Found {} programs for channel {} in source {}",
                                programs.len(),
                                channel_name,
                                source.url
                            );
                            all_programs.extend(programs.clone());
                        }
                    }
                    // Sort programs by start time
                    all_programs.sort_by(|a, b| a.start.cmp(&b.start));
                    all_programs
                }
                None => Vec::new(),
            }
        }
        None => Vec::new(),
    };

    if programs.is_empty() {
        warn!("No programs found for channel name: {}", channel_name);
    } else {
        info!(
            "Found {} total programs for channel {}",
            programs.len(),
            channel_name
        );
    }

    Ok(programs)
}

pub async fn get_epg_by_range(
    start_time: String,
    end_time: String,
    skip: usize,
    limit: usize,
    playlist_channel_names: Vec<String>,
) -> Result<Vec<EpgChannelWithPrograms>, String> {
    println!("EPG Request - skip: {}, limit: {}", skip, limit);
    println!("Channel names count: {}", playlist_channel_names.len());

    match EPG_DATA.get() {
        Some(epg_data) => {
            let guard = epg_data.lock().map_err(|e| e.to_string())?;
            let store = guard.as_ref().ok_or("EPG data not initialized")?;

            let mut result = Vec::new();

            // Parse time range
            let start = DateTime::parse_from_str(&start_time, "%Y%m%d%H%M%S %z")
                .map_err(|e| e.to_string())?
                .with_timezone(&Utc);
            let end = DateTime::parse_from_str(&end_time, "%Y%m%d%H%M%S %z")
                .map_err(|e| e.to_string())?
                .with_timezone(&Utc);

            // First collect all channels with their programs
            let mut all_channels_data = Vec::new();

            // Collect all unique channel IDs across all sources that match playlist channel names
            for source in &store.sources {
                for (channel_id, programs) in &source.programs {
                    if let Some(first_program) = programs.first() {
                        let channel_name = first_program.channel.trim();
                        if playlist_channel_names.iter().any(|name| name.trim() == channel_name) {
                            // Check if we already have this channel
                            if !all_channels_data.iter().any(|(id, _)| id == channel_id) {
                                let mut channel_programs = Vec::new();
                                let mut channel_icon = None;

                                // Collect programs from all sources for this channel
                                for source in &store.sources {
                                    if let Some(progs) = source.programs.get(channel_id) {
                                        let filtered_programs: Vec<Program> = progs
                                            .iter()
                                            .filter(|p| p.start <= end && p.stop >= start)
                                            .cloned()
                                            .collect();

                                        if channel_icon.is_none() {
                                            if let Some(prog) = filtered_programs.first() {
                                                channel_icon = prog.icon.clone();
                                            }
                                        }

                                        channel_programs.extend(filtered_programs);
                                    }
                                }

                                if !channel_programs.is_empty() {
                                    // Sort programs by start time
                                    channel_programs.sort_by(|a, b| a.start.cmp(&b.start));
                                    all_channels_data.push((channel_id.clone(), (channel_name.to_string(), channel_icon, channel_programs)));
                                }
                            }
                        }
                    }
                }
            }

            // Sort channels by name for consistent ordering
            all_channels_data.sort_by(|a, b| a.1.0.cmp(&b.1.0));

            println!("Total matching channels found: {}", all_channels_data.len());

            // Now apply pagination to the full list of channels
            let start_idx = skip.min(all_channels_data.len());
            let end_idx = (skip + limit).min(all_channels_data.len());
            let paginated_data = &all_channels_data[start_idx..end_idx];

            println!("Returning channels from index {} to {}", start_idx, end_idx);

            // Convert to final format
            for (channel_id, (channel_name, channel_icon, channel_programs)) in paginated_data {
                result.push(EpgChannelWithPrograms {
                    id: channel_id.to_string(),
                    name: channel_name.clone(),
                    icon: channel_icon.clone(),
                    programs: channel_programs.clone(),
                });
            }

            println!("Returning {} channels", result.len());
            Ok(result)
        }
        None => Err("EPG data not initialized".to_string()),
    }
}

#[derive(Debug, Serialize)]
pub struct EpgChannelWithPrograms {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub programs: Vec<Program>,
}
