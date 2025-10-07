export interface EpgItem {
    id: string;
    epg_id: string;
    title: string;
    lang: string;
    start: string;
    end: string;
    stop: string;
    description: string;
    channel_id: string;
    start_timestamp: string;
    stop_timestamp: string;
}
