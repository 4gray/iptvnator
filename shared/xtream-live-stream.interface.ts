export interface XtreamLiveStream {
    num: number;
    name: string;
    stream_type: 'live';
    stream_id: number;
    stream_icon: string;
    epg_channel_id?: number;
    added: string;
    category_id: string;
    custom_sid?: string;
    tv_archive: number;
    direct_source?: string;
    tv_archive_duration: number;
}
