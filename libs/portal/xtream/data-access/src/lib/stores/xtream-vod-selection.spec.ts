import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import {
    buildXtreamVodSelection,
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

    it('maps an Electron database category id back to the provider id', () => {
        expect(
            resolveXtreamVodCatalogCategoryId([{ id: 7, xtream_id: 701 }], 7)
        ).toBe(701);
        expect(
            resolveXtreamVodCatalogCategoryId([{ category_id: '702' }], '702')
        ).toBe('702');
    });

    it('does not treat an unresolved database category id as a provider id', () => {
        expect(resolveXtreamVodCatalogCategoryId([], 7)).toBeNull();
    });
});
