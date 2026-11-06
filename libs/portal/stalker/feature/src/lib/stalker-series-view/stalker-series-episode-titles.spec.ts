import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { withEpisodeTitleFallback } from './stalker-series-episode-titles';

const episode = (
    episodeNum: number,
    title: string
): XtreamSerieEpisode & { originalCmd: string } => ({
    id: String(episodeNum),
    episode_num: episodeNum,
    title,
    container_extension: '',
    info: {},
    custom_sid: 'regular-series',
    added: '',
    season: 1,
    direct_source: '',
    originalCmd: `cmd-${episodeNum}`,
});

describe('withEpisodeTitleFallback', () => {
    const label = (episodeNumber: number) => `Folge ${episodeNumber}`;

    it('labels unnamed episodes and keeps the provider fields', () => {
        const result = withEpisodeTitleFallback(
            { '1': [episode(1, ''), episode(2, '   ')] },
            label
        );

        expect(result['1'].map((item) => item.title)).toEqual([
            'Folge 1',
            'Folge 2',
        ]);
        expect(result['1'][0]).toMatchObject({ originalCmd: 'cmd-1' });
    });

    it('leaves named episodes untouched', () => {
        const named = episode(3, 'A real name');

        const result = withEpisodeTitleFallback({ '2': [named] }, label);

        expect(result['2'][0]).toBe(named);
    });
});
