import { extractStalkerItemId } from '../stalker-item.normalizer';
import { stalkerFavoriteReference } from './favorites-stalker-reference';

describe('historical Stalker favorite references', () => {
    it('uses the displayed provider ID when an alternative stream ID differs', () => {
        const item = {
            id: '42',
            stream_id: '84',
            favoriteContentType: 'itv' as const,
            title: 'Synthetic channel',
        };
        expect(extractStalkerItemId(item)).toBe('42');
        expect(stalkerFavoriteReference(item)).toEqual({
            provider: 'stalker',
            kind: 'live',
            id: '42',
        });
    });
    it.each([
        [{ id: '42', category_id: 'series', series: [1, 2] }, 'embedded'],
        [{ id: '42', category_id: 'series', is_series: '1' }, 'lazy'],
        [{ id: '42', category_id: 'series' }, 'regular'],
    ] as const)('preserves legacy series origin for %o', (item, mode) => {
        expect(
            stalkerFavoriteReference({
                ...item,
                series: 'series' in item ? [...item.series] : undefined,
            })
        ).toEqual({ provider: 'stalker', kind: 'series', id: '42', mode });
    });
    it.each(['true', ' TRUE ', '1'])(
        'keeps the supported radio marker %s',
        (radio) => {
            expect(
                stalkerFavoriteReference({
                    id: '42',
                    category_id: 7,
                    stream_type: 'live',
                    radio,
                })
            ).toEqual({ provider: 'stalker', kind: 'radio', id: '42' });
        }
    );
    it('uses the radio stream type but never infers identity from a command', () => {
        expect(
            stalkerFavoriteReference({
                id: '42',
                category_id: 7,
                stream_type: 'radio',
            })
        ).toEqual({ provider: 'stalker', kind: 'radio', id: '42' });
        expect(
            stalkerFavoriteReference({
                id: '42',
                category_id: 7,
                cmd: 'ffrt4://radio/42/index.mp3',
            })
        ).toBeNull();
    });
    it('keeps the string radio marker without widening the series predicate', () => {
        expect(
            stalkerFavoriteReference({
                id: '42',
                category_id: 7,
                stream_type: 'live',
                radio: 'true',
                is_series: 'true',
            })
        ).toEqual({ provider: 'stalker', kind: 'radio', id: '42' });
    });
});
