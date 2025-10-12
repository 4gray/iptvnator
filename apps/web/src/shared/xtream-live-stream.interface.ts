import { XtreamItem } from '../../../../libs/shared/interfaces/src/lib/xtream-item.interface';

export interface XtreamLiveStream extends XtreamItem {
    stream_type: 'live';
    epg_channel_id?: number;
    tv_archive: number;
    tv_archive_duration: number;
}
