import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    pickRandomEpisode,
    pickRandomEpisodeOrSeason,
} from './pick-random-episode.util';

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

describe('pickRandomEpisodeOrSeason', () => {
    it('picks from loaded episodes when no season is unloaded', () => {
        const a = episode('s1e1', 1);
        const b = episode('s1e2', 1);
        expect(
            pickRandomEpisodeOrSeason({ '1': [a, b] }, [], () => 0.99)
        ).toEqual({ kind: 'episode', episode: b });
    });

    it('returns undefined when there is nothing to pick', () => {
        expect(pickRandomEpisodeOrSeason({ '1': [] }, [])).toBeUndefined();
    });

    it('can pick an unloaded season so it is loaded first', () => {
        const seasons = {
            '1': [episode('s1e1', 1), episode('s1e2', 1)],
            '2': [],
        };
        // Loaded: 2 episodes. Unloaded season 2 weighs the loaded average (2).
        // Total 4, so a draw past the loaded half lands on season 2.
        expect(pickRandomEpisodeOrSeason(seasons, ['2'], () => 0.75)).toEqual({
            kind: 'season',
            seasonKey: '2',
        });
        expect(pickRandomEpisodeOrSeason(seasons, ['2'], () => 0.25)).toEqual({
            kind: 'episode',
            episode: seasons['1'][1],
        });
    });

    it('spreads unloaded seasons evenly when none is loaded yet', () => {
        const seasons = { '1': [], '2': [], '3': [] };
        const keys = ['1', '2', '3'];
        expect(pickRandomEpisodeOrSeason(seasons, keys, () => 0)).toEqual({
            kind: 'season',
            seasonKey: '1',
        });
        expect(pickRandomEpisodeOrSeason(seasons, keys, () => 0.5)).toEqual({
            kind: 'season',
            seasonKey: '2',
        });
        expect(pickRandomEpisodeOrSeason(seasons, keys, () => 1)).toEqual({
            kind: 'season',
            seasonKey: '3',
        });
    });
});
