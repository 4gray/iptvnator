import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { pickRandomEpisode } from './pick-random-episode.util';

function episode(id: string, season: number): XtreamSerieEpisode {
    return {
        id,
        episode_num: 1,
        title: id,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        season,
        direct_source: '',
    };
}

describe('pickRandomEpisode', () => {
    it('returns undefined when there are no episodes', () => {
        expect(pickRandomEpisode({})).toBeUndefined();
        expect(pickRandomEpisode({ '1': [] })).toBeUndefined();
    });

    it('returns the only episode when the series has one', () => {
        const only = episode('s1e1', 1);
        expect(pickRandomEpisode({ '1': [only] })).toBe(only);
    });

    it('flattens across seasons and selects by the injected random source', () => {
        const seasons = {
            '1': [episode('s1e1', 1), episode('s1e2', 1)],
            '2': [episode('s2e1', 2)],
        };
        expect(pickRandomEpisode(seasons, () => 0)?.id).toBe('s1e1');
        expect(pickRandomEpisode(seasons, () => 0.5)?.id).toBe('s1e2');
        expect(pickRandomEpisode(seasons, () => 0.99)?.id).toBe('s2e1');
    });

    it('never indexes out of range when random() returns 1', () => {
        const seasons = { '1': [episode('a', 1), episode('b', 1)] };
        expect(pickRandomEpisode(seasons, () => 1)).toBe(seasons['1'][1]);
    });
});
