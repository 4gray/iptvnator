import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MultiviewPickerCategory } from './multiview-picker-category';
import type { MultiviewPickerData } from './multiview-picker-data.service';
import { liveItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import type { MultiviewPickerSectionId } from './multiview-picker-sections';

const rows = [1, 2, 3].map((id) => toPickerRow(liveItem(id), []));

function data(overrides: Partial<MultiviewPickerData>): MultiviewPickerData {
    return {
        sections: [],
        playlistGroups: [
            { id: 'news', name: 'News' },
            { id: 'sport', name: 'Sport' },
        ],
        playlistRowGroups: new Map([
            [rows[0].sessionKey, 'news'],
            [rows[1].sessionKey, 'sport'],
            [rows[2].sessionKey, 'news'],
        ]),
        playlistPaged: false,
        ...overrides,
    };
}

describe('MultiviewPickerCategory', () => {
    const section = signal<MultiviewPickerSectionId>('playlist');
    const loadGroup = jest.fn();

    function create(value: MultiviewPickerData) {
        return TestBed.runInInjectionContext(
            () =>
                new MultiviewPickerCategory({
                    data: signal(value),
                    section,
                    loadGroup,
                })
        );
    }

    beforeEach(() => {
        loadGroup.mockReset();
        section.set('playlist');
    });

    it('filters a fully loaded playlist by group', async () => {
        const category = create(data({}));
        expect(category.rows(rows)).toEqual(rows);

        await category.select('news');

        expect(category.rows(rows)).toEqual([rows[0], rows[2]]);
        expect(category.selectedName()).toBe('News');
        expect(loadGroup).not.toHaveBeenCalled();
    });

    it('loads one group at a time for a paged portal, starting with the first', async () => {
        loadGroup
            .mockResolvedValueOnce([rows[0]])
            .mockResolvedValueOnce([rows[1]]);
        const category = create(data({ playlistPaged: true }));

        TestBed.tick();
        await Promise.resolve();
        await Promise.resolve();
        expect(loadGroup).toHaveBeenCalledWith('news');
        expect(category.rows([])).toEqual([rows[0]]);

        await category.select('sport');
        expect(category.rows([])).toEqual([rows[1]]);
        expect(category.loading()).toBe(false);
    });

    it('keeps the latest choice when an earlier group loads late', async () => {
        let finishNews: (value: unknown) => void = () => undefined;
        loadGroup
            .mockImplementationOnce(() => new Promise((r) => (finishNews = r)))
            .mockResolvedValueOnce([rows[1]]);
        const category = create(data({ playlistPaged: true }));
        section.set('live-now');

        const news = category.select('news');
        await category.select('sport');
        finishNews([rows[0]]);
        await news;

        expect(category.rows([])).toEqual([rows[1]]);
    });

    it('does not open a group until the playlist section is shown', () => {
        section.set('recent');
        create(data({ playlistPaged: true }));
        TestBed.tick();

        expect(loadGroup).not.toHaveBeenCalled();
    });
});
