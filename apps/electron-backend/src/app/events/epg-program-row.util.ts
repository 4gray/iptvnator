import { EpgProgram } from '@iptvnator/shared/interfaces';

/**
 * Shared shape for a raw `epg_programs` row as read by both
 * `EpgQueryService` and `EpgGuideQueryService`. Callers with additional
 * columns (e.g. `id`) satisfy this structurally without extending it.
 */
export interface EpgProgramRow {
    channelId: string;
    start: string;
    stop: string;
    title: string;
    description: string | null;
    category: string | null;
    iconUrl: string | null;
    rating: string | null;
    episodeNum: string | null;
}

/** Maps a raw DB row onto the public `EpgProgram` shape. No validation. */
export function toEpgProgramFromRow(row: EpgProgramRow): EpgProgram {
    return {
        start: row.start,
        stop: row.stop,
        channel: row.channelId,
        title: row.title,
        desc: row.description,
        category: row.category,
        iconUrl: row.iconUrl,
        rating: row.rating,
        episodeNum: row.episodeNum,
    };
}

/**
 * A programme is only usable once its start/stop are non-empty AND parse to
 * a real instant — a malformed XMLTV timestamp must not reach the renderer
 * as a bogus block.
 */
export function isValidEpgProgram(program: EpgProgram): boolean {
    return Boolean(
        program.start &&
        program.stop &&
        !Number.isNaN(new Date(program.start).getTime()) &&
        !Number.isNaN(new Date(program.stop).getTime())
    );
}
