import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import type { Playlist, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { StalkerCollectionMetadataService } from './stalker-collection-metadata.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';

const source = {
    _id: 'synthetic-source',
    portalUrl: 'https://portal.example/load.php',
    macAddress: '00:11:22:33:44:55',
    sourceSyncRevision: 'synthetic-first',
} as Playlist;
const sparse = {
    id: '42',
    title: 'Synthetic series',
    favoriteContentType: 'vod',
    series: [1, 2, 3, 4],
} as StalkerPortalItem;
const fresh = {
    ...sparse,
    cover: 'https://artwork.example/series.jpg',
    description: 'Synthetic provider synopsis',
    cmd: 'synthetic-private-command',
};
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('received Stalker collection metadata', () => {
    let service: StalkerCollectionMetadataService;
    let metadata: jest.Mock;
    let current: Playlist;
    let version: number;
    beforeEach(() => {
        current = { ...source };
        version = 0;
        metadata = jest.fn(async () => fresh);
        TestBed.configureTestingModule({
            providers: [
                StalkerCollectionMetadataService,
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById: () => of(current) },
                },
                {
                    provide: ParentalLockService,
                    useValue: { version: () => version },
                },
                {
                    provide: StalkerFavoritePlaybackResolver,
                    useValue: { metadata },
                },
            ],
        });
        service = TestBed.inject(StalkerCollectionMetadataService);
    });
    afterEach(() => jest.restoreAllMocks());

    it.each(['regular', 'embedded', 'lazy'] as const)(
        'fills favorites and recent artwork/description in the background (%s)',
        async (mode) => {
            const item = {
                ...sparse,
                favoriteContentType:
                    mode === 'regular' ? ('series' as const) : ('vod' as const),
                series: mode === 'embedded' ? [1, 2, 3, 4] : undefined,
                is_series: mode === 'lazy' ? true : undefined,
            };
            const playlist = {
                ...source,
                favorites: [item],
                recentlyViewed: [{ ...item, added_at: '2026-01-01T00:00:00Z' }],
            };
            expect(service.project(playlist).favorites![0]).toBe(item);
            await settle();
            const projected = service.project(playlist);
            expect(projected.favorites![0]).toMatchObject({
                id: '42',
                cover: fresh.cover,
                info: { description: fresh.description },
            });
            expect(projected.recentlyViewed![0]).toMatchObject({
                cover: fresh.cover,
                added_at: '2026-01-01T00:00:00Z',
            });
            expect(metadata).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(projected)).not.toContain(fresh.cmd);
            expect(playlist.favorites[0]).toEqual(item);
            expect(service.revision()).toBe(1);
        }
    );

    it.each([
        [
            { screenshot_uri: '/artwork/synthetic.jpg' },
            'https://portal.example/artwork/synthetic.jpg',
        ],
        [
            { cover: 'artwork/synthetic.jpg' },
            'https://portal.example/artwork/synthetic.jpg',
        ],
        [
            { info: { movie_image: '//artwork.example/synthetic.jpg' } },
            'https://artwork.example/synthetic.jpg',
        ],
        [
            {
                cover: 'javascript:synthetic',
                screenshot_uri: '/artwork/synthetic.jpg',
            },
            'https://portal.example/artwork/synthetic.jpg',
        ],
    ])(
        'resolves received artwork against the portal (%j)',
        async (artwork, cover) => {
            metadata.mockResolvedValueOnce({
                ...fresh,
                cover: undefined,
                ...artwork,
            });
            service.item(source, sparse);
            await settle();
            expect(service.item(source, sparse)).toMatchObject({
                cover,
                info: { movie_image: cover },
            });
        }
    );

    it.each(['source', 'device', 'locks'] as const)(
        'discards a late lookup after %s changes',
        async (change) => {
            let release!: (value: typeof fresh) => void;
            metadata.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    })
            );
            service.item(source, sparse);
            await settle();
            if (change === 'source')
                current = {
                    ...source,
                    sourceSyncRevision: 'synthetic-replacement',
                };
            else if (change === 'device')
                current = {
                    ...source,
                    stalkerSerialNumber: 'synthetic-replacement',
                };
            else version++;
            release(fresh);
            await settle();
            expect(service.revision()).toBe(0);
            expect(service.item(source, sparse)).toBe(sparse);
        }
    );

    it('preserves enriched presentation, playback commands and episode arrays while filling artwork', async () => {
        const episodes = [1];
        const item = {
            ...sparse,
            series: episodes,
            cmd: 'synthetic-active-command',
            info: {
                name: 'Synthetic existing title',
                description: 'Synthetic enriched synopsis',
            },
        };
        service.item(source, item);
        await settle();
        const projected = service.item(source, item);
        expect(projected).toMatchObject({
            cover: fresh.cover,
            cmd: item.cmd,
            info: item.info,
        });
        expect(projected.series).toBe(episodes);
        expect(item.cover).toBeUndefined();
    });

    it('keeps the snapshot readable during an outage and retries after a backoff', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
        metadata.mockRejectedValueOnce(new Error('Synthetic portal offline'));
        expect(service.item(source, sparse)).toBe(sparse);
        await settle();
        expect(service.item(source, sparse)).toBe(sparse);
        expect(metadata).toHaveBeenCalledTimes(1);
        now.mockReturnValue(31_001);
        service.item(source, sparse);
        await settle();
        expect(service.item(source, sparse)).toMatchObject({
            cover: fresh.cover,
        });
        expect(metadata).toHaveBeenCalledTimes(2);
    });

    it('shares hydrated metadata with a native inventory row that omits payload-only fields', async () => {
        current = { ...source, stalkerSerialNumber: 'synthetic-device' };
        service.item(current, sparse);
        await settle();
        const {
            sourceSyncRevision: _revision,
            stalkerSerialNumber: _serial,
            ...nativeMeta
        } = current;
        expect(service.item(nativeMeta, sparse)).toMatchObject({
            cover: fresh.cover,
        });
        expect(metadata).toHaveBeenCalledTimes(1);
    });

    it('serializes sparse-card lookups without blocking their initial projection', async () => {
        let release!: (value: typeof fresh) => void;
        metadata.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                })
        );
        service.item(source, sparse);
        service.item(source, { ...sparse, id: '43' });
        await settle();
        expect(metadata).toHaveBeenCalledTimes(1);
        release(fresh);
        await settle();
        expect(metadata).toHaveBeenCalledTimes(2);
    });
});
