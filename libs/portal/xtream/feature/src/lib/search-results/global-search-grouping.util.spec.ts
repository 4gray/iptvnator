import { XtreamSearchResultItem } from '@iptvnator/portal/xtream/data-access';
import { groupResultsByVariant } from './global-search-grouping.util';

function item(
    title: string,
    overrides: Partial<XtreamSearchResultItem> = {}
): XtreamSearchResultItem {
    return {
        id: title,
        title,
        type: 'movie',
        ...overrides,
    } as unknown as XtreamSearchResultItem;
}

const displayType = (i: XtreamSearchResultItem): string =>
    (i as { type?: string }).type ?? 'movie';

describe('groupResultsByVariant', () => {
    it('collapses tagged variants of one title into a single group', () => {
        const groups = groupResultsByVariant(
            [
                item('DE| The Pitt'),
                item('4K-TR - The Pitt (2025) (US)'),
                item('The Pitt (2025)'),
                item('|ALB| The Pitt'),
            ],
            displayType
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].items).toHaveLength(4);
        expect(groups[0].representative.title).toBe('DE| The Pitt');
    });

    it('labels the group with the cleanest member title', () => {
        const groups = groupResultsByVariant(
            [item('DE| The Pitt'), item('The Pitt (2025)'), item('|ALB| The Pitt')],
            displayType
        );

        expect(groups[0].displayTitle).toBe('The Pitt');
    });

    it('never merges different content types with the same title', () => {
        const groups = groupResultsByVariant(
            [
                item('The Pitt', { type: 'series' }),
                item('The Pitt', { type: 'movie' }),
            ],
            displayType
        );

        expect(groups).toHaveLength(2);
    });

    it('keeps unrelated titles in separate groups', () => {
        const groups = groupResultsByVariant(
            [item('The Pitt'), item('The Pradeeps of Pittsburgh')],
            displayType
        );

        expect(groups).toHaveLength(2);
    });

    it('preserves first-seen group order and ranked member order', () => {
        const groups = groupResultsByVariant(
            [
                item('EN| Fallout'),
                item('The Last of Us'),
                item('DE| Fallout'),
            ],
            displayType
        );

        expect(groups.map((g) => g.displayTitle)).toEqual([
            'Fallout',
            'The Last of Us',
        ]);
        expect(groups[0].items.map((i) => i.title)).toEqual([
            'EN| Fallout',
            'DE| Fallout',
        ]);
    });

    it('gives titles that normalize to nothing their own group', () => {
        const groups = groupResultsByVariant(
            [item('|DE|', { id: 'a' }), item('|FR|', { id: 'b' })],
            displayType
        );

        expect(groups).toHaveLength(2);
    });
});
