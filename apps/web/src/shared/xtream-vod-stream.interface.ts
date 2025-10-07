import { XtreamItem } from './xtream-item.interface';

export interface XtreamVodStream extends XtreamItem {
    stream_type: 'movie';
    rating: number;
    rating_5based: number;
    container_extension: string;
}
