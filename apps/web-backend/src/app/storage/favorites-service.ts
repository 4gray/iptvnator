import { randomUUID } from 'node:crypto';
import {
    activitySourceFingerprint,
    initializeActivitySources,
} from './activity-source-lifecycle';
import { SqliteFavoriteServerStore } from '@iptvnator/shared/database/favorites-sync';
import { sourceFromPlaylist } from '@iptvnator/shared/interfaces/source-definition';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type {
    FavoriteAddress,
    FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

/** Source lifecycle metadata is independent of source revisions, which reset at process startup. */
export class ServerFavoriteService {
    readonly states: SqliteFavoriteServerStore;
    constructor(private readonly storage: ServerStorage) {
        initializeActivitySources(storage.database.sqlite);
        this.states = new SqliteFavoriteServerStore(
            storage.database.sqlite,
            (address) => this.authorize(address)
        );
    }

    context(id: string): FavoriteSourceContext {
        const document = this.storage.playlists.getMeta(id);
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
        const provider = source.kind.startsWith('m3u-') ? 'm3u' : source.kind;
        if (
            provider !== 'xtream' &&
            provider !== 'stalker' &&
            provider !== 'm3u'
        ) {
            throw new StorageRequestError(
                400,
                'unsupported_source',
                'This source does not support favorites.'
            );
        }
        const existing = this.storage.database.sqlite
            .prepare(
                'SELECT fingerprint, incarnation FROM activity_source_context WHERE source_id = ?'
            )
            .get(id) as
            { fingerprint: string; incarnation: string } | undefined;
        // Source writes retire text identities transactionally; only a cold context needs the payload.
        if (source.kind === 'm3u-text') {
            if (existing)
                return {
                    sourceId: id,
                    provider,
                    sourceIncarnation: existing.incarnation,
                };
            source.rawM3u = sourceFromPlaylist(
                this.storage.playlists.get(id) as unknown as Playlist,
                true
            ).rawM3u;
        }
        const fingerprint = activitySourceFingerprint(source);
        if (existing?.fingerprint === fingerprint) {
            return {
                sourceId: id,
                provider,
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
            provider,
            sourceIncarnation: incarnation,
        };
    }

    private authorize(address: FavoriteAddress): void {
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
