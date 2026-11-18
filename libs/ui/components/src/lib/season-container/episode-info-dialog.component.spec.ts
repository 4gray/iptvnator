import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    buildEpisodeInfoDialogData,
    episodeSubtitleKey,
} from './episode-info-dialog.component';

function episode(overrides: Partial<XtreamSerieEpisode>): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Synthetic episode',
        container_extension: 'mp4',
        info: {},
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    } as XtreamSerieEpisode;
}

describe('episode info dialog subtitle', () => {
    it('names a known season 0 (specials) with its episode', () => {
        const special = buildEpisodeInfoDialogData(
            episode({ season: 0, episode_num: 3 }),
            '0'
        );

        expect(special).toMatchObject({ seasonNumber: 0, episodeNumber: 3 });
        expect(episodeSubtitleKey(special)).toBe('DIALOGS.EPISODE_SEASON');
    });

    it('leaves out a season the provider does not know', () => {
        const flat = buildEpisodeInfoDialogData(
            episode({ season: 9, episode_num: 189, seasonUnknown: true }),
            '9'
        );

        expect(flat.seasonNumber).toBeUndefined();
        expect(flat.episodeNumber).toBe(189);
        expect(episodeSubtitleKey(flat)).toBe('DIALOGS.EPISODE');
    });
});
