import type { ElectronBridgeXtreamFavorite } from '@iptvnator/shared/interfaces';
import { toXtreamBackupFavorite } from './xtream-favorite-backup';

describe('Electron favorite conflict evidence in portable backups', () => {
    it('exports a known conflict with the durable identity and ordering', () => {
        const saved = {
            xtream_id: 7,
            type: 'movie',
            title: 'Original',
            tmdb_id: 100,
            release_year: 2000,
            added_at: '2020-01-01',
            position: 4,
            catalog_status: 'unknown',
            catalog_missing_reason: 'identity_conflict',
        } as ElectronBridgeXtreamFavorite;
        expect(toXtreamBackupFavorite(saved)).toEqual({
            xtreamId: 7,
            contentType: 'movie',
            addedAt: '2020-01-01',
            position: 4,
            snapshot: {
                title: 'Original',
                tmdbId: 100,
                releaseYear: 2000,
                catalogStatus: 'missing',
                catalogMissingReason: 'identity_conflict',
            },
        });
    });
    it('does not turn ordinary absence into an identity conflict', () => {
        const snapshot = toXtreamBackupFavorite({
            xtream_id: 7,
            type: 'movie',
            title: 'Original',
            catalog_status: 'missing',
            catalog_missing_reason: null,
        } as ElectronBridgeXtreamFavorite).snapshot;
        expect(snapshot?.catalogMissingReason).toBeUndefined();
    });
});
