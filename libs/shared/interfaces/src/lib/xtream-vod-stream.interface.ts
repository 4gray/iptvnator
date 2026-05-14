import { XtreamItem } from './xtream-item.interface';

export interface XtreamVodStream extends XtreamItem {
    stream_type: 'movie';
    rating: number;
    rating_5based: number;
    container_extension: string;
    imdb_id?: string;
    imdbRating?: number;
    imdbVotes?: number;
    imdbMatchedTitle?: string;
    imdbMatchedYear?: number;
    imdbMatchConfidence?: number;
    imdbMatchReason?: string;
    duplicateCount?: number;
    duplicateDefaultVariantId?: string;
    duplicateGroupKey?: string;
    duplicateQualityLabel?: string;
    duplicateQualityScore?: number;
    duplicateVariants?: XtreamVodStream[];
}
