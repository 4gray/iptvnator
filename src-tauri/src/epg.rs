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
