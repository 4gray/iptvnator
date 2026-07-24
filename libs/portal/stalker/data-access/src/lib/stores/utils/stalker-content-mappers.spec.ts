import { StalkerItvChannel } from '../../models';
import { filterItvChannelsByGenre } from './stalker-content-mappers';

describe('filterItvChannelsByGenre', () => {
    const CHANNELS: StalkerItvChannel[] = [
        { id: '1', cmd: 'ffrt http://x/1', name: 'News One', tv_genre_id: '5' },
        { id: '2', cmd: 'ffrt http://x/2', name: 'Sports HD', tv_genre_id: 9 },
        { id: '3', cmd: 'ffrt http://x/3', name: 'No Genre' },
    ];

    it('returns all channels for the "*" category', () => {
        expect(filterItvChannelsByGenre(CHANNELS, '*')).toHaveLength(3);
    });

    it('returns all channels when no category is selected', () => {
        expect(filterItvChannelsByGenre(CHANNELS, null)).toHaveLength(3);
        expect(filterItvChannelsByGenre(CHANNELS, undefined)).toHaveLength(3);
    });

    it('matches numeric and string genre ids', () => {
        expect(
            filterItvChannelsByGenre(CHANNELS, '5').map((item) => item.id)
        ).toEqual(['1']);
        expect(
            filterItvChannelsByGenre(CHANNELS, '9').map((item) => item.id)
        ).toEqual(['2']);
    });

    it('hides channels without a genre from specific categories', () => {
        expect(filterItvChannelsByGenre(CHANNELS, '404')).toEqual([]);
    });
});
