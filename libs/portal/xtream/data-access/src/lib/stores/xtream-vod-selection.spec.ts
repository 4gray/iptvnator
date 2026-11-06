import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    buildXtreamVodSelection,
    findXtreamVodCatalogItem,
    resolveXtreamVodCatalogCategoryId,
} from './xtream-vod-selection';

describe('Xtream VOD selection helpers', () => {
    it.each([
        ['cached', null],
        ['recovered', null],
        ['cached', undefined],
        ['recovered', undefined],
    ] as const)(
        'keeps a %s source when the detail payload is %p',
        (kind, detail) => {
            const candidate = {
                stream_id: 42,
                container_extension: 'mp4',
            } as XtreamVodStream;
            const selection = buildXtreamVodSelection(
                detail,
                kind === 'cached' ? candidate : undefined,
                42,
                kind === 'recovered' ? candidate : undefined
            );
            expect(resolveXtreamVodPlaybackSource(selection)).toEqual({
                streamId: 42,
                containerExtension: 'mp4',
            });
        }
    );

    it.each(['cached', 'recovered'])(
        'does not reject %s playback using a TMDB-supplied year',
        (kind) => {
            const candidate = {
                stream_id: 42,
                container_extension: 'mp4',
                tmdb_id: 100,
                release_year: 2020,
            } as unknown as XtreamVodStream;
            const selection = buildXtreamVodSelection(
                {
                    info: {
                        tmdb_id: 100,
                        releasedate: '2024-01-01',
                        tmdb_supplied_release_date: true,
                    },
                } as Parameters<typeof buildXtreamVodSelection>[0],
                kind === 'cached' ? candidate : undefined,
                42,
                kind === 'recovered' ? candidate : undefined
            );
            expect(resolveXtreamVodPlaybackSource(selection)).toEqual({
                streamId: 42,
                containerExtension: 'mp4',
            });
        }
    );

    it('merges a sparse detail response with its catalog playback fields', () => {
        const catalogItem = {
            stream_id: 42,
            container_extension: 'mp4',
            name: 'Catalog title',
            stream_icon: 'catalog-poster.jpg',
            xtream_id: 42,
        } as XtreamVodStream;

        expect(buildXtreamVodSelection({ info: [] }, catalogItem, 42)).toEqual(
            expect.objectContaining({
                info: [],
                stream_id: 42,
                container_extension: 'mp4',
                name: 'Catalog title',
                stream_icon: 'catalog-poster.jpg',
                xtream_id: 42,
            })
        );
    });

    it('strips provider stand-ins from the detail info it publishes', () => {
        const selection = buildXtreamVodSelection(
            {
                info: {
                    name: 'Placeholder Film',
                    releasedate: 'N/A',
                    rating_imdb: 'N/A',
                    director: '-',
                },
            } as unknown as Parameters<typeof buildXtreamVodSelection>[0],
            undefined,
            42
        );

        expect(selection.info).toEqual({
            name: 'Placeholder Film',
            releasedate: '',
            rating_imdb: '',
            director: '',
        });
    });

    it('keeps a complete detail playback pair ahead of a catalog collision', () => {
        const catalogItem = {
            stream_id: 42,
            container_extension: 'mkv',
            xtream_id: 42,
        } as XtreamVodStream;

        expect(
            buildXtreamVodSelection(
                {
                    info: [],
                    stream_id: 42,
                    container_extension: 'mp4',
                } as unknown as Parameters<typeof buildXtreamVodSelection>[0],
                catalogItem,
                42
            )
        ).toEqual(
            expect.objectContaining({
                stream_id: 42,
                container_extension: 'mp4',
            })
        );
    });

    it('falls back to one complete catalog pair instead of mixing fields', () => {
        const catalogItem = {
            stream_id: 42,
            container_extension: 'mkv',
            xtream_id: 42,
        } as XtreamVodStream;

        expect(
            buildXtreamVodSelection(
                {
                    info: [],
                    stream_id: 99,
                } as unknown as Parameters<typeof buildXtreamVodSelection>[0],
                catalogItem,
                42
            )
        ).toEqual(
            expect.objectContaining({
                stream_id: 42,
                container_extension: 'mkv',
            })
        );
    });

    it('prefers a complete recovered pair over the cached catalog pair', () => {
        expect(
            buildXtreamVodSelection(
                { info: [] },
                {
                    stream_id: 42,
                    container_extension: 'mp4',
                } as XtreamVodStream,
                42,
                {
                    stream_id: 42,
                    container_extension: 'mkv',
                } as XtreamVodStream
            )
        ).toEqual(
            expect.objectContaining({
                stream_id: 42,
                container_extension: 'mkv',
            })
        );
    });

    it('does not synthesize a source from incomplete catalog candidates', () => {
        const selection = buildXtreamVodSelection(
            { info: [] },
            { stream_id: 42 } as XtreamVodStream,
            42,
            { container_extension: 'mkv' } as XtreamVodStream
        );

        expect(resolveXtreamVodPlaybackSource(selection)).toBeNull();
    });

    it.each([null, undefined, '', '   '])(
        'recovers the reported VOD with extension %p from its exact catalog row',
        (extension) => {
            const detail = {
                info: { tmdb_id: 693134, name: 'Duna: Parte Dois' },
                movie_data: {
                    stream_id: 15616981,
                    name: 'Duna Parte Dois [L]',
                    category_id: '2656',
                    container_extension: extension,
                    direct_source: '',
                },
            } as unknown as Parameters<typeof buildXtreamVodSelection>[0];
            const selection = buildXtreamVodSelection(
                detail,
                {
                    stream_id: 15616981,
                    container_extension: 'mkv',
                } as XtreamVodStream,
                15616981
            );
            expect(resolveXtreamVodPlaybackSource(selection)).toEqual({
                streamId: 15616981,
                containerExtension: 'mkv',
            });
            expect(
                resolveXtreamVodPlaybackSource(
                    buildXtreamVodSelection(detail, undefined, 15616981)
                )
            ).toBeNull();
        }
    );

    it('does not borrow a direct source or format from a different provider stream', () => {
        const selection = buildXtreamVodSelection({ info: [] }, undefined, 42, {
            stream_id: 99,
            container_extension: 'mp4',
            direct_source: 'https://media.example/wrong',
        } as XtreamVodStream);
        expect(resolveXtreamVodPlaybackSource(selection)).toBeNull();
    });

    it.each(['cached', 'recovered'])(
        'rejects contradictory provider IDs in a %s candidate',
        (kind) => {
            const candidate = {
                xtream_id: 42,
                stream_id: 99,
                container_extension: 'mp4',
                direct_source: 'https://media.example/wrong',
            } as XtreamVodStream;
            const selection = buildXtreamVodSelection(
                { info: [] },
                kind === 'cached' ? candidate : undefined,
                42,
                kind === 'recovered' ? candidate : undefined
            );
            expect(resolveXtreamVodPlaybackSource(selection)).toBeNull();
        }
    );

    it('discards a detail response for another stream instead of relabeling its metadata', () => {
        const selection = buildXtreamVodSelection(
            {
                info: { name: 'Wrong movie', tmdb_id: 999 },
                movie_data: {
                    stream_id: 99,
                    container_extension: 'mp4',
                    direct_source: 'https://media.example/wrong',
                },
            } as unknown as Parameters<typeof buildXtreamVodSelection>[0],
            undefined,
            42
        );
        expect(selection.info).toEqual([]);
        expect(resolveXtreamVodPlaybackSource(selection)).toBeNull();
    });

    it.each([{ tmdb_id: 200 }, { release_year: 2020 }])(
        'does not borrow playback from a reused catalog ID with conflicting identity %p',
        (identity) => {
            const selection = buildXtreamVodSelection(
                { info: { tmdb_id: 100, releasedate: '2024-01-01' } } as never,
                {
                    ...identity,
                    stream_id: 42,
                    container_extension: 'mp4',
                    name: 'Replacement',
                } as unknown as XtreamVodStream,
                42
            );
            expect(resolveXtreamVodPlaybackSource(selection)).toBeNull();
            expect(selection['name']).toBeUndefined();
        }
    );

    it('preserves an explicit recovered direct source as a complete candidate', () => {
        const selection = buildXtreamVodSelection({ info: [] }, undefined, 42, {
            stream_id: 42,
            direct_source: 'https://media.example/movie',
        } as XtreamVodStream);
        expect(resolveXtreamVodPlaybackSource(selection)).toMatchObject({
            streamId: 42,
            directSource: 'https://media.example/movie',
        });
    });

    it('finds a catalog row by its provider VOD id', () => {
        const matchingItem = {
            stream_id: 42,
            container_extension: 'mp4',
        } as XtreamVodStream;

        expect(
            findXtreamVodCatalogItem(
                [{ stream_id: 7 } as XtreamVodStream, matchingItem],
                42
            )
        ).toBe(matchingItem);
    });

    it('maps an Electron database category id back to the provider id', () => {
        expect(
            resolveXtreamVodCatalogCategoryId([{ id: 7, xtream_id: 701 }], 7)
        ).toBe(701);
        expect(
            resolveXtreamVodCatalogCategoryId([{ category_id: '702' }], '702')
        ).toBe('702');
    });

    it('accepts a provider category id from cross-portal detail links', () => {
        expect(
            resolveXtreamVodCatalogCategoryId([{ id: 7, xtream_id: 701 }], 701)
        ).toBe(701);
    });

    it('does not treat an optional PWA id as a database category id', () => {
        expect(
            resolveXtreamVodCatalogCategoryId([{ id: 7, category_id: 701 }], 7)
        ).toBeNull();
    });

    it('does not treat an unresolved database category id as a provider id', () => {
        expect(resolveXtreamVodCatalogCategoryId([], 7)).toBeNull();
    });
});
