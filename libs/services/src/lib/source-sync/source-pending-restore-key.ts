import { getXtreamPendingRestoreStorageKey } from '@iptvnator/shared/interfaces';
import { sourceConnection } from './source-connection';
import { wasLegacySourceClient } from './legacy-source-client';
import { sourceProfileStorageKey } from './source-profile-storage';

/** Adopt a parked archive only for the browser's verified legacy instance. */
export function sourcePendingRestoreStorageKey(playlistId: string): string {
    const original = getXtreamPendingRestoreStorageKey(playlistId);
    const scoped = sourceProfileStorageKey(original);
    if (scoped === original) return original;
    const marker = `${scoped}:legacy-migrated`;
    if (localStorage.getItem(marker) !== '1') {
        const connection = sourceConnection();
        if (
            localStorage.getItem(scoped) === null &&
            connection &&
            !window.electron?.sourceSyncConnection &&
            wasLegacySourceClient(connection.instanceId)
        ) {
            const legacy = localStorage.getItem(original);
            if (legacy !== null) {
                localStorage.setItem(scoped, legacy);
                if (localStorage.getItem(scoped) !== legacy)
                    throw new Error(
                        'Pending restore migration was not persisted'
                    );
            }
        }
        // Persist even an absent snapshot, so later clears cannot resurrect it.
        localStorage.setItem(marker, '1');
        if (localStorage.getItem(marker) !== '1')
            throw new Error(
                'Pending restore migration receipt was not persisted'
            );
    }
    return scoped;
}
