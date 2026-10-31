import { randomUUID, createHash } from 'node:crypto';
import { SqliteActivityServerStore } from '@iptvnator/shared/database/activity-sync';
import {
    sourceFingerprint,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type {
    ActivityAddress,
    ActivitySourceContext,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

/** Source lifecycle metadata is independent of source revisions, which reset at process startup. */
export class ServerActivityService {
    readonly states: SqliteActivityServerStore;
    constructor(private readonly storage: ServerStorage) {
        storage.database.sqlite.exec(`
            CREATE TABLE IF NOT EXISTS activity_source_context (
                source_id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL, incarnation TEXT NOT NULL
            );
            CREATE TRIGGER IF NOT EXISTS activity_source_deleted AFTER DELETE ON playlists
                BEGIN DELETE FROM activity_source_context WHERE source_id = OLD.id; END;
        `);
        this.states = new SqliteActivityServerStore(
            storage.database.sqlite,
            (address) => this.authorize(address)
        );
    }

    context(id: string): ActivitySourceContext {
        const document = this.storage.playlists.get(id);
        if (!document)
            throw new StorageRequestError(
                404,
                'playlist_missing',
                'Source no longer exists.'
            );
        const source = sourceFromPlaylist(
            document as unknown as Playlist,
            false
        );
        if (source.kind !== 'xtream' && source.kind !== 'stalker') {
            throw new StorageRequestError(
                400,
                'unsupported_source',
                'This source does not support viewing activity.'
            );
        }
        const fingerprint = createHash('sha256')
            .update(sourceFingerprint(source))
            .digest('hex');
        const existing = this.storage.database.sqlite
            .prepare(
                'SELECT fingerprint, incarnation FROM activity_source_context WHERE source_id = ?'
            )
            .get(id) as
            { fingerprint: string; incarnation: string } | undefined;
        if (existing?.fingerprint === fingerprint) {
            return {
                sourceId: id,
                provider: source.kind,
                sourceIncarnation: existing.incarnation,
            };
        }
        const incarnation = randomUUID();
        this.storage.database.sqlite
            .prepare(
                `INSERT INTO activity_source_context (source_id, fingerprint, incarnation) VALUES (?, ?, ?)
             ON CONFLICT(source_id) DO UPDATE SET fingerprint = excluded.fingerprint, incarnation = excluded.incarnation`
            )
            .run(id, fingerprint, incarnation);
        return {
            sourceId: id,
            provider: source.kind,
            sourceIncarnation: incarnation,
        };
    }

    private authorize(address: ActivityAddress): void {
        if (address.instanceId !== this.storage.database.instanceId) {
            throw new StorageRequestError(
                409,
                'instance_changed',
                'Server identity changed.'
            );
        }
        const context = this.context(address.sourceId);
        if (
            context.sourceIncarnation !== address.sourceIncarnation ||
            context.provider !== address.content.provider
        ) {
            throw new StorageRequestError(
                409,
                'source_changed',
                'Source identity changed.'
            );
        }
    }
}
