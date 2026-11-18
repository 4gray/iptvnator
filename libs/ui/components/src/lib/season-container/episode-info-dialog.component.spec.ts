import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    buildEpisodeInfoDialogData,
    EpisodeInfoDialogComponent,
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

    it('renders the season and episode subtitle in the dialog header', async () => {
        await TestBed.configureTestingModule({
            imports: [EpisodeInfoDialogComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: buildEpisodeInfoDialogData(
                        episode({ season: 0, episode_num: 3 }),
                        '0'
                    ),
                },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(EpisodeInfoDialogComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;

        expect(
            root.querySelector('.app-dialog__icon')?.textContent?.trim()
        ).toBe('info');
        // No translations are loaded, so the key is the rendered text.
        expect(
            root.querySelector('.app-dialog__subtitle')?.textContent?.trim()
        ).toBe('DIALOGS.EPISODE_SEASON');
    });
});
