import { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';

/**
 * Pure helpers for the unified live tab's collapsed EPG summary: pick the
 * on-air programme from either EPG shape and flatten it for the panel header.
 */

export function getLiveEpgPanelSummary(
    detail: ResolvedLiveCollectionDetail | null
): LiveEpgPanelSummary | null {
    if (!detail) {
        return null;
    }

    if (detail.epgMode === 'm3u') {
        return toLiveEpgPanelSummary(
            findCurrentM3uProgram(detail.epgPrograms ?? [])
        );
    }

    return toLiveEpgPanelSummary(
        findCurrentPortalProgram(detail.epgItems ?? [])
    );
}

export function toLiveEpgPanelSummary(
    program: EpgItem | EpgProgram | null | undefined
): LiveEpgPanelSummary | null {
    if (!program) {
        return null;
    }

    return {
        title: program.title,
        start: program.start,
        stop: program.stop ?? ('end' in program ? program.end : null),
    };
}

/** Normalise a portal EPG item into the flat timeline programme shape. */
export function toEpgProgram(item: EpgItem): EpgProgram {
    return {
        start: item.start,
        stop: item.stop ?? item.end,
        channel: item.channel_id ?? item.id,
        title: item.title,
        desc: item.description ?? null,
        category: null,
        startTimestamp: toTimestampSeconds(item.start_timestamp),
        stopTimestamp: toTimestampSeconds(item.stop_timestamp),
    };
}

function findCurrentM3uProgram(
    programs: readonly EpgProgram[]
): EpgProgram | null {
    const now = Date.now();
    return (
        programs.find((program) => {
            const start = getProgramTimeMs(
                program.start,
                program.startTimestamp
            );
            const stop = getProgramTimeMs(program.stop, program.stopTimestamp);

            return (
                start !== null && stop !== null && now >= start && now < stop
            );
        }) ?? null
    );
}

function findCurrentPortalProgram(
    programs: readonly EpgItem[]
): EpgItem | null {
    const now = Date.now();
    return (
        programs.find((program) => {
            const start = getProgramTimeMs(
                program.start,
                program.start_timestamp
            );
            const stop = getProgramTimeMs(
                program.stop ?? program.end,
                program.stop_timestamp
            );

            return (
                start !== null && stop !== null && now >= start && now < stop
            );
        }) ?? null
    );
}

/**
 * Convert program start/stop to epoch seconds, preferring the
 * numeric timestamp (which is provider-native) over the ISO string.
 */
export function toEpochSeconds(
    timestamp: number | null | undefined,
    fallbackIso: string
): number | null {
    if (timestamp != null && Number.isFinite(timestamp)) {
        return timestamp;
    }

    const ms = Date.parse(fallbackIso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function getProgramTimeMs(
    rawDate: string | null | undefined,
    rawTimestamp?: number | string | null
): number | null {
    const timestamp = Number.parseInt(String(rawTimestamp ?? ''), 10);
    if (Number.isFinite(timestamp) && timestamp > 0) {
        return timestamp * 1000;
    }

    const parsedDate = Date.parse(rawDate ?? '');
    return Number.isFinite(parsedDate) ? parsedDate : null;
}

function toTimestampSeconds(value: string | null | undefined): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
