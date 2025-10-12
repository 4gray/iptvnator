import { XtreamItem } from 'shared-interfaces';

export interface XtreamLiveStream extends XtreamItem {
    stream_type: 'live';
    epg_channel_id?: number;
    tv_archive: number;
    tv_archive_duration: number;
}
