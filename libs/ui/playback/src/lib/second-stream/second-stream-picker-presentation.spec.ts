import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER } from 'rxjs';
import {
    SecondStreamCatalogService,
    SecondStreamEpgService,
    SecondStreamVodService,
    type SecondStreamEpisode,
} from '@iptvnator/portal/shared/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
import { SecondStreamPickerComponent } from './second-stream-picker.component';

const series: UnifiedCollectionItem = {
    uid: 'fixture-series',
    name: 'Fixture series',
    contentType: 'series',
    sourceType: 'xtream',
    playlistId: 'fixture',
    playlistName: 'Fixture source',
    posterUrl: 'https://art.example.test/poster.jpg',
};
const episode = {
    season: 1,
    episode: {
        id: '42',
        episode_num: 4,
        title: 'Fixture finale',
        season: 1,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        direct_source: '',
    },
    position: {
        contentType: 'episode',
        contentXtreamId: 42,
        positionSeconds: 30,
        durationSeconds: 120,
    },
} satisfies SecondStreamEpisode;

describe('SecondStreamPicker presentation', () => {
    let fixture: ComponentFixture<SecondStreamPickerComponent>;
    let component: SecondStreamPickerComponent;
    let root: HTMLElement;
    const episodes = jest.fn();
    const resolveEpisode = jest.fn();
    const findDuplicateSlot = jest.fn();
    beforeEach(async () => {
        episodes.mockReset().mockResolvedValue([episode]);
        resolveEpisode.mockReset();
        findDuplicateSlot.mockReset();
        TestBed.configureTestingModule({
            imports: [SecondStreamPickerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: { slot: 2, findDuplicateSlot },
                },
                {
                    provide: MatDialogRef,
                    useValue: { beforeClosed: () => NEVER, close: jest.fn() },
                },
                {
                    provide: SecondStreamCatalogService,
                    useValue: {
                        version: signal(0),
                        sources: async () => [],
                        load: async () => ({ groups: [], channels: [] }),
                    },
                },
                {
                    provide: SecondStreamVodService,
                    useValue: { episodes, resolveEpisode },
                },
                {
                    provide: SecondStreamEpgService,
                    useValue: { xmltvAvailable$: NEVER },
                },
                {
                    provide: EpgPreferencesService,
                    useValue: { enabled: signal(false) },
                },
                {
                    provide: EpgSourceSettingsService,
                    useValue: { revision: signal(0) },
                },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
            ],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            XTREAM: { WATCHED: 'Watched' },
            TWO_STREAMS: {
                DUPLICATE_WINDOW: 'Already open in window {{slot}}',
            },
            WORKSPACE: { DASHBOARD: { PERCENT_WATCHED: '{{value}}% watched' } },
            PORTALS: {
                SEASON_TAB: 'Season {{number}}',
                DETAIL: {
                    EPISODE_NUMBER: 'Episode {{episode}}',
                },
            },
        });
        translate.use('en');
        fixture = TestBed.createComponent(SecondStreamPickerComponent);
        component = fixture.componentInstance;
        root = fixture.nativeElement;
        fixture.detectChanges();
        await fixture.whenStable();
        component.vod.type.set('series');
        component.vod.items.set([series]);
        fixture.detectChanges();
    });

    it('renders lazy posters and keeps failures scoped to the failed URL', () => {
        let image = root.querySelector<HTMLImageElement>('.picker__poster img');
        expect(image?.getAttribute('src')).toBe(series.posterUrl);
        expect(image?.getAttribute('loading')).toBe('lazy');
        image?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(root.querySelector('.picker__poster img')).toBeNull();
        expect(
            root.querySelector('.picker__poster mat-icon')?.textContent
        ).toContain('video_library');
        component.vod.items.set([
            {
                ...series,
                posterUrl: 'https://art.example.test/replacement.jpg',
            },
        ]);
        fixture.detectChanges();
        image = root.querySelector('.picker__poster img');
        expect(image?.getAttribute('src')).toContain('replacement.jpg');
        expect(root.querySelector('.picker__vod-text')?.textContent).toContain(
            'Fixture source'
        );
    });

    it('renders episode stills, translated progress and a read-only watched indicator', () => {
        component.vod.series.set(series);
        component.vod.episodes.set([
            {
                ...episode,
                episode: {
                    ...episode.episode,
                    info: {
                        movie_image: 'https://art.example.test/still.jpg',
                        plot: 'A fictional expedition.',
                    } as Exclude<typeof episode.episode.info, unknown[]>,
                },
            },
            {
                ...episode,
                episode: {
                    ...episode.episode,
                    id: '43',
                    episode_num: 5,
                    title: '',
                },
                position: { ...episode.position, positionSeconds: 120 },
            },
        ]);
        fixture.detectChanges();
        const rows =
            root.querySelectorAll<HTMLButtonElement>('.picker__vod-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('img')?.getAttribute('src')).toContain(
            'still.jpg'
        );
        expect(
            rows[0]
                .querySelector('.picker__progress > span')
                ?.getAttribute('style')
        ).toContain('25%');
        expect(rows[0].textContent).toContain('25% watched');
        expect(rows[0].textContent).toContain('A fictional expedition.');
        expect(rows[1].querySelector('strong')?.textContent).toContain(
            'Episode 5'
        );
        expect(
            rows[1].querySelector('.picker__episode-thumb--fallback')
        ).not.toBeNull();
        expect(
            rows[1].querySelector('.picker__episode-watched')?.textContent
        ).toContain('Watched');
        expect(rows[1].querySelector('.picker__progress')).toBeNull();
        expect(rows[1].querySelector('button')).toBeNull();
        const choose = jest
            .spyOn(component, 'chooseEpisode')
            .mockImplementation(() => undefined);
        rows[1].click();
        expect(choose).toHaveBeenCalledWith(
            series,
            component.vod.episodes()[1]
        );
        component.resolving.set('42');
        fixture.detectChanges();
        expect(rows[0].disabled).toBe(true);
    });

    it('keeps early saved progress visible until the episode is watched', () => {
        const early = {
            ...episode,
            position: { ...episode.position, positionSeconds: 8 },
        };
        expect(component.vod.episodeProgress(early)).toBe(7);
        expect(
            component.vod.episodeProgress({
                ...early,
                position: { ...early.position, watched: true },
            })
        ).toBe(0);
        expect(
            component.vod.episodeProgress({
                ...early,
                position: { ...early.position, positionSeconds: 108 },
            })
        ).toBe(0);
    });

    it('blocks just the open episode while keeping its series available', async () => {
        findDuplicateSlot.mockImplementation((identity) =>
            identity?.contentInfo?.contentXtreamId === 42 ? 3 : undefined
        );
        const row = root.querySelector<HTMLButtonElement>('.picker__vod-row');
        expect(row?.getAttribute('aria-disabled')).toBeNull();
        row?.click();
        await fixture.whenStable();
        fixture.detectChanges();
        const opened = root.querySelector<HTMLButtonElement>(
            '[data-episode-id="42"]'
        );
        expect(opened?.textContent).toContain('Already open in window 3');
        expect(opened?.getAttribute('aria-disabled')).toBe('true');
        opened?.click();
        expect(resolveEpisode).not.toHaveBeenCalled();
    });

    it('returns focus to the search after opening and leaving a series', async () => {
        const row = root.querySelector<HTMLButtonElement>('.picker__vod-row');
        if (!row) throw new Error('Missing catalogue row');
        row.focus();
        row.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(document.activeElement).toBe(root.querySelector('input'));
        root.querySelector<HTMLButtonElement>(
            '.picker__series button'
        )?.focus();
        component.backToSeries();
        fixture.detectChanges();
        expect(document.activeElement).toBe(root.querySelector('input'));
    });
});
