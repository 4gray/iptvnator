import {
    AutoUpdatePlaylistsResult,
    AutoUpdatePlaylistsSummary,
    summarizeAutoUpdateOutcomes,
} from '@iptvnator/shared/interfaces';

export const AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS = {
    failed: 'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_FAILED',
    partial: 'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL',
    partialWithSkipped:
        'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_PARTIAL_WITH_SKIPPED',
    skipped: 'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SKIPPED',
    success: 'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SUCCESS',
} as const;

export interface AutoUpdatePlaylistsFeedback {
    messageKey: string;
    params: AutoUpdatePlaylistsSummary;
    /** Failures deserve a dismissable, longer-lived snackbar. */
    isError: boolean;
}

/**
 * Turns an auto-refresh result into the snackbar message the user should see.
 * The backend isolates per-playlist failures, so "some playlists were updated"
 * must never be reported as "all playlists were updated".
 */
export function buildAutoUpdatePlaylistsFeedback(
    result: AutoUpdatePlaylistsResult
): AutoUpdatePlaylistsFeedback {
    const summary = summarizeAutoUpdateOutcomes(result.outcomes);

    if (summary.failed > 0) {
        return {
            messageKey: resolveFailureMessageKey(summary),
            params: summary,
            isError: true,
        };
    }

    if (summary.skipped > 0) {
        return {
            messageKey: AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS.skipped,
            params: summary,
            isError: false,
        };
    }

    return {
        messageKey: AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS.success,
        params: summary,
        isError: false,
    };
}

/**
 * Every playlist the user was not told about looks like an unexplained
 * remainder, so a batch that both failed and skipped needs a message that
 * accounts for all three counts — `partial` alone leaves `total` unreconciled.
 */
function resolveFailureMessageKey(summary: AutoUpdatePlaylistsSummary): string {
    if (summary.updated === 0) {
        return AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS.failed;
    }

    return summary.skipped > 0
        ? AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS.partialWithSkipped
        : AUTO_UPDATE_PLAYLISTS_MESSAGE_KEYS.partial;
}
