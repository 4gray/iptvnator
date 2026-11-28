import { signal } from '@angular/core';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { createCollectionContentTypeState } from './unified-collection-content-type';

const movie: UnifiedCollectionItem = {
    uid: 'xtream::fixture::movie:7',
    name: 'Saved movie',
    sourceType: 'xtream',
    contentType: 'movie',
    playlistId: 'fixture',
    playlistName: 'Fixture source',
    xtreamId: 7,
};

describe('collection tabs with favorite channel folders', () => {
    it.each([
        { hasFolders: false, firstTab: 'movie' },
        { hasFolders: true, firstTab: 'live' },
    ])(
        'allows an empty Live tab with initial selection $firstTab',
        ({ hasFolders, firstTab }) => {
            const state = createCollectionContentTypeState(
                signal([movie]),
                'live',
                {
                    enabled: signal(true),
                    hasFolders: () => hasFolders,
                }
            );

            state.autoSelect();
            expect(state.selected()).toBe(firstTab);
            expect(state.showToggle()).toBe(true);

            state.select('live');
            state.autoSelect();
            expect(state.selected()).toBe('live');
        }
    );

    it('returns to the empty Live tab after the last saved movie is removed', () => {
        const items = signal([movie]);
        const state = createCollectionContentTypeState(items, 'movie', {
            enabled: signal(true),
            hasFolders: () => true,
        });

        items.set([]);
        state.autoSelect();

        expect(state.selected()).toBe('live');
        expect(state.showToggle()).toBe(false);
    });
});
