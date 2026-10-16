import * as schema from '@iptvnator/shared/database/schema';

export function selectContentFields() {
    return {
        id: schema.content.id,
        category_id: schema.content.categoryId,
        title: schema.content.title,
        rating: schema.content.rating,
        added: schema.content.added,
        poster_url: schema.content.posterUrl,
        epg_channel_id: schema.content.epgChannelId,
        tv_archive: schema.content.tvArchive,
        tv_archive_duration: schema.content.tvArchiveDuration,
        direct_source: schema.content.directSource,
        xtream_id: schema.content.xtreamId,
        type: schema.content.type,
    };
}
