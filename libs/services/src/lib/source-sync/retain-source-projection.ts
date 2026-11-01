import { type Playlist } from '@iptvnator/shared/interfaces';
import { applySourceDefinition } from '@iptvnator/shared/interfaces/source-definition';
import { resolvePlaylistEpgSourceState } from '@iptvnator/shared/m3u-utils';

/** Merge delayed device activity without restoring an obsolete parsed source or session. */
export function retainSourceProjection(
    current: Playlist,
    incoming: Playlist
): Playlist {
    const next = applySourceDefinition(current.sourceSyncBase!, incoming);
    const fields = [
        'playlist',
        'count',
        'updateDate',
        'updateState',
        'sourceSyncBase',
        'sourceSyncRevision',
        'sourceSyncPending',
        'stalkerToken',
        'stalkerSessionIdentity',
        'stalkerAccountInfo',
        'stalkerWatchdogTimeout',
        'stalkerTimeslot',
        'serverTimezone',
    ] as const;
    for (const field of fields) {
        delete (next as Partial<Playlist>)[field];
        if (current[field] !== undefined)
            Object.assign(next, { [field]: current[field] });
    }
    return Object.assign(
        next,
        { autoImportEpg: incoming.autoImportEpg ?? current.autoImportEpg },
        resolvePlaylistEpgSourceState({
            autoImportEpg: incoming.autoImportEpg ?? current.autoImportEpg,
            detectedEpgUrls: current.detectedEpgUrls,
            enabledEpgUrls: current.epgUrls?.filter(
                (url) =>
                    current.detectedEpgUrls?.includes(url) ||
                    !current.manualEpgUrls?.includes(url)
            ),
            manualEpgUrls: incoming.manualEpgUrls,
            disabledEpgUrls: incoming.disabledEpgUrls,
        })
    );
}
