import type { StalkerMappedEpisode } from './stalker-series.adapters';

export type StalkerEpisodeCommand = Pick<
    StalkerMappedEpisode,
    'originalCmd' | 'custom_sid' | 'vodEpisode'
>;

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function command(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Resolve episode coordinates to a real provider media file, without UI dependencies. */
export async function resolveStalkerEpisodeCommand(
    episode: StalkerEpisodeCommand,
    request: (params: Record<string, string>) => Promise<unknown>
): Promise<string> {
    // Some panels supply the episode's own playable command directly.
    // This is deliberately never the parent show's saved command.
    const ownCommand = command(episode.originalCmd);
    if (ownCommand) return ownCommand;

    const coordinates = episode.vodEpisode;
    if (
        episode.custom_sid !== 'vod-series' ||
        !coordinates ||
        !Object.values(coordinates).every((id) => id.trim())
    ) {
        throw new Error('nothing_to_play');
    }
    const response = await request({
        action: 'get_ordered_list',
        type: 'vod',
        movie_id: coordinates.movieId,
        season_id: coordinates.seasonId,
        episode_id: coordinates.episodeId,
        p: '1',
    });
    const js = object(response)?.['js'];
    const envelope = object(js);
    const rows = Array.isArray(js) ? js : envelope?.['data'];
    if (envelope?.['error'] || !Array.isArray(rows)) {
        throw new Error('nothing_to_play');
    }
    // Keep provider ordering among video variants (quality/language).
    // Never substitute the episode ID or parent command for a missing file.
    for (const value of rows) {
        const file = object(value);
        if (!file || ![true, 1, '1'].some((flag) => flag === file['is_file'])) {
            continue;
        }
        if (file['file_type'] != null && file['file_type'] !== 'video')
            continue;
        if (
            file['video_id'] != null &&
            String(file['video_id']) !== coordinates.movieId
        )
            continue;
        if (
            file['series_id'] != null &&
            String(file['series_id']) !== coordinates.episodeId
        )
            continue;
        const cmd = command(file['cmd']);
        if (!cmd) continue;
        if (file['protocol'] === 'custom') {
            // Ministra exposes a raw URL, but create_link still needs the
            // actual media-file ID (as in the reference player's is_file branch).
            const fileId = String(file['id'] ?? '');
            if (/^[1-9]\d*$/.test(fileId)) return `/media/file_${fileId}.mpg`;
            continue;
        }
        return cmd;
    }
    throw new Error('nothing_to_play');
}
