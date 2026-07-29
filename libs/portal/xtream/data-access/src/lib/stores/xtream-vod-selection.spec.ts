import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    buildXtreamVodSelection,
    findXtreamVodCatalogItem,
    resolveXtreamVodCatalogCategoryId,
} from './xtream-vod-selection';

describe('Xtream VOD selection helpers', () => {
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
