import { inject, Injectable, Injector, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { favoriteSourceRetirementKey } from '@iptvnator/services/favorites-sync';
import type {
    PlaylistMeta,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { stalkerSessionFingerprint } from '@iptvnator/shared/interfaces/stalker-session';
import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { mergeStalkerDisplayInfo } from './stalker-display-info';
import { createStalkerInfo } from './stalker-vod.utils';
import type { StalkerVodSource } from './models';
import { resolveStalkerArtwork } from './stalker-artwork.utils';

@Injectable({ providedIn: 'root' })
export class StalkerCollectionMetadataService {
    private readonly injector = inject(Injector);
    private readonly changed = signal(0);
    readonly revision = this.changed.asReadonly();
    private readonly cache = new Map<
        string,
        { value?: StalkerVodSource; retryAt: number }
    >();
    private queue = Promise.resolve();

    project<T extends PlaylistMeta>(playlist: T): T {
        this.revision();
        if (!playlist.macAddress) return playlist;
        return {
            ...playlist,
            favorites: playlist.favorites?.map((item) =>
                typeof item === 'object' && item
                    ? this.item(playlist, item)
                    : item
            ),
            recentlyViewed: playlist.recentlyViewed?.map((item) =>
                !item ||
                typeof item !== 'object' ||
                ('source' in item && item.source === 'm3u')
                    ? item
                    : this.item(playlist, item)
            ),
        };
    }

    item<T extends StalkerPortalItem>(playlist: PlaylistMeta, item: T): T {
        this.revision();
        const reference = stalkerFavoriteReference(item);
        if (!reference || ['live', 'radio'].includes(reference.kind))
            return item;
        const info = createStalkerInfo(item as StalkerVodSource);
        if (info.movie_image && info.description) return item;
        const key = this.key(playlist, item);
        const cached = this.cache.get(key);
        if (cached?.value) return mergeStalkerDisplayInfo(item, cached.value);
        if (cached && cached.retryAt > Date.now()) return item;
        this.cache.set(key, { retryAt: Infinity });
        const current = captureHistoryOwner(
            sourceConnection()?.instanceId,
            playlist._id,
            () => sourceConnection()?.instanceId
        );
        // A slow portal must not block collection reads or fan out one request per card.
        this.queue = this.queue.then(async () => {
            try {
                if (!current()) return;
                const full = await firstValueFrom(
                    this.injector
                        .get(PlaylistsService)
                        .getPlaylistById(playlist._id)
                );
                if (!full || !current() || this.key(full, item) !== key) return;
                if (
                    playlist.sourceSyncRevision !== undefined &&
                    playlist.sourceSyncRevision !== full.sourceSyncRevision
                )
                    return;
                const owner = this.fullScope(full);
                const { StalkerFavoritePlaybackResolver } =
                    await import('./stalker-favorite-playback.service');
                const value = await this.injector
                    .get(StalkerFavoritePlaybackResolver)
                    .metadata(full, item);
                const latest = await firstValueFrom(
                    this.injector
                        .get(PlaylistsService)
                        .getPlaylistById(playlist._id)
                );
                if (
                    !latest ||
                    !current() ||
                    this.key(latest, item) !== key ||
                    this.fullScope(latest) !== owner
                )
                    return;
                const display = createStalkerInfo(value as StalkerVodSource);
                display.movie_image =
                    resolveStalkerArtwork(
                        full.portalUrl ?? full.url ?? '',
                        display.movie_image,
                        (value as StalkerVodSource).screenshot_uri,
                        value.logo
                    ) ?? '';
                this.cache.set(key, {
                    value: { info: display },
                    retryAt: Infinity,
                });
                this.changed.update((revision) => revision + 1);
                window.dispatchEvent(new Event('iptvnator-favorites-changed'));
                window.dispatchEvent(new Event('iptvnator-history-changed'));
            } catch {
                this.cache.set(key, { retryAt: Date.now() + 30_000 });
            } finally {
                const cached = this.cache.get(key);
                if (cached?.retryAt === Infinity && !cached.value)
                    this.cache.delete(key);
            }
        });
        return item;
    }

    private key(playlist: PlaylistMeta, item: StalkerPortalItem): string {
        const instanceId = sourceConnection()?.instanceId;
        return JSON.stringify([
            instanceId,
            playlist._id,
            // Native inventory intentionally omits payload-only identity and revision fields.
            playlist.portalUrl ?? playlist.url,
            playlist.macAddress,
            playlist.username,
            playlist.password,
            playlist.userAgent,
            playlist.origin,
            playlist.referrer,
            instanceId
                ? localStorage.getItem(favoriteSourceRetirementKey(instanceId))
                : null,
            favoriteReferenceKey(stalkerFavoriteReference(item)!),
            this.injector.get(ParentalLockService).version(),
        ]);
    }

    private fullScope(playlist: PlaylistMeta): string {
        return JSON.stringify([
            stalkerSessionFingerprint(playlist),
            playlist.sourceSyncRevision,
            playlist.isFullStalkerPortal,
        ]);
    }
}
