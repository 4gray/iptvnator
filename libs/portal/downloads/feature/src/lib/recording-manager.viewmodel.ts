import type { RecordingItem } from '@iptvnator/services';
import { normalizeDownloadFilter } from './download-manager.viewmodel';

export type RecordingAttentionReason = 'file-missing' | 'failed';

export interface RecordingRowViewModel {
    readonly item: RecordingItem;
    /** Program title when EPG knew one; empty otherwise (template falls back
     *  to channel + start time, which needs the locale-aware date pipe). */
    readonly programTitle: string;
    readonly channelName: string;
    readonly attentionReason: RecordingAttentionReason | null;
    /** endedAt − startedAt in whole seconds; null while recording/unknown. */
    readonly durationSeconds: number | null;
    readonly interrupted: boolean;
}

export interface RecordingManagerViewModel {
    readonly active: readonly RecordingRowViewModel[];
    readonly attention: readonly RecordingRowViewModel[];
    readonly library: readonly RecordingRowViewModel[];
    /** Chip badge: every scoped recording regardless of the active filter. */
    readonly count: number;
}

export interface BuildRecordingManagerViewModelInput {
    readonly recordings: readonly RecordingItem[];
    readonly scopePlaylistId?: string;
    readonly filter: string | null | undefined;
    readonly searchTerm?: string;
}

export function recordingDurationSeconds(
    item: RecordingItem
): number | null {
    if (!item.endedAt) {
        return null;
    }
    const started = Date.parse(item.startedAt);
    const ended = Date.parse(item.endedAt);
    if (
        !Number.isFinite(started) ||
        !Number.isFinite(ended) ||
        ended <= started
    ) {
        return null;
    }
    return Math.floor((ended - started) / 1000);
}

function isPlayableStatus(item: RecordingItem): boolean {
    return item.status === 'completed' || item.status === 'interrupted';
}

function attentionReason(
    item: RecordingItem
): RecordingAttentionReason | null {
    if (item.status === 'failed') {
        return 'failed';
    }
    if (isPlayableStatus(item) && item.fileAvailability === 'missing') {
        return 'file-missing';
    }
    return null;
}

function toRow(item: RecordingItem): RecordingRowViewModel {
    return {
        item,
        programTitle: item.programTitle?.trim() ?? '',
        channelName: item.channelName,
        attentionReason: attentionReason(item),
        durationSeconds: recordingDurationSeconds(item),
        interrupted: item.status === 'interrupted',
    };
}

function matchesSearch(row: RecordingRowViewModel, searchTerm: string): boolean {
    const query = searchTerm.trim().toLowerCase();
    return (
        query.length === 0 ||
        [
            row.programTitle,
            row.channelName,
            row.item.playlistName ?? '',
            row.item.errorMessage ?? '',
        ].some((value) => value.toLowerCase().includes(query))
    );
}

function compareNewestFirst(
    left: RecordingRowViewModel,
    right: RecordingRowViewModel
): number {
    return (
        Date.parse(right.item.startedAt) - Date.parse(left.item.startedAt) ||
        right.item.id - left.item.id
    );
}

/**
 * Sibling of buildDownloadManagerViewModel for live-TV recordings.
 *
 * The 'movie'/'series' chips hide recordings symmetrically to how the
 * 'recording' chip hides downloads. 'in-progress' is about what is running
 * right now, so it keeps the active recordings (and only those) — its chip
 * counts them, and a chip whose count does not match its page is a lie.
 */
export function buildRecordingManagerViewModel({
    recordings,
    scopePlaylistId,
    filter,
    searchTerm = '',
}: BuildRecordingManagerViewModelInput): RecordingManagerViewModel {
    const scoped = recordings.filter(
        (item) =>
            scopePlaylistId === undefined || item.playlistId === scopePlaylistId
    );
    const activeFilter = normalizeDownloadFilter(filter);
    const showsRecordings =
        activeFilter === 'all' ||
        activeFilter === 'recording' ||
        activeFilter === 'in-progress';
    const visible = showsRecordings
        ? scoped.map(toRow).filter((row) => matchesSearch(row, searchTerm))
        : [];
    const activeOnly = activeFilter === 'in-progress';

    return {
        active: visible
            .filter(({ item }) => item.status === 'recording')
            .sort(compareNewestFirst),
        attention: activeOnly
            ? []
            : visible
                  .filter((row) => row.attentionReason !== null)
                  .sort(compareNewestFirst),
        library: activeOnly
            ? []
            : visible
                  .filter(
                      (row) =>
                          row.attentionReason === null &&
                          isPlayableStatus(row.item)
                  )
                  .sort(compareNewestFirst),
        count: scoped.length,
    };
}
