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

    it('splits same-title remakes with different years', () => {
        const groups = groupResultsByVariant(
            [
                item('Dune (1984)'),
                item('DE| Dune (2021)'),
                item('Dune (2021)'),
            ],
            displayType
        );

        expect(groups).toHaveLength(2);
        expect(groups.map((g) => g.items.length).sort()).toEqual([1, 2]);
    });

    it('keeps one group when only some variants carry the year', () => {
        const groups = groupResultsByVariant(
            [
                item('DE| The Pitt'),
                item('The Pitt (2025)'),
                item('|ALB| The Pitt'),
            ],
            displayType
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].items).toHaveLength(3);
    });

    it('prefers a representative that has a poster', () => {
        const groups = groupResultsByVariant(
            [
                item('DE| The Pitt', { id: 1, poster_url: '' }),
                item('The Pitt (2025)', { id: 2, poster_url: 'poster.jpg' }),
            ],
            displayType
        );

        expect(groups[0].representative.poster_url).toBe('poster.jpg');
    });

    it('applies a key prefix so identical titles stay independent', () => {
        const a = groupResultsByVariant([item('DE| The Pitt')], displayType, 'p1::');
        const b = groupResultsByVariant([item('DE| The Pitt')], displayType, 'p2::');

        expect(a[0].key).not.toBe(b[0].key);
        expect(a[0].key.startsWith('p1::')).toBe(true);
    });
});
