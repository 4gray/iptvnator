import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { DownloadItem } from '@iptvnator/services';
import type { DownloadSeriesCardViewModel } from './download-library.viewmodel';
import { DownloadedSeriesDialogComponent } from './downloaded-series-dialog.component';

const TRANSLATIONS = {
    CLOSE: 'Close',
    DOWNLOADS: {
        COPY_URL: 'Copy download URL',
        DOWNLOADED_EPISODES: 'Downloaded episodes',
        EPISODE_COUNT: '{{count}} episodes',
        PLAY: 'Play',
        REMOVE_FROM_MANAGER: 'Remove from manager',
        REVEAL: 'Show in folder',
    },
};

function episode(overrides: Partial<DownloadItem>): DownloadItem {
    return {
        id: 31,
        playlistId: 'playlist-series',
        xtreamId: 501,
        contentType: 'episode',
        seriesXtreamId: 88,
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Signal House - S01E01 - Arrival',
        url: 'https://media.example.test/episode',
        status: 'completed',
        bytesDownloaded: 1_500_000,
        ...overrides,
    };
}

const MEMBERS = [
    episode({ id: 31 }),
    episode({
        id: 32,
        xtreamId: 502,
        episodeNumber: 3,
        title: 'Signal House - S01E03 - Relay',
    }),
    episode({
        id: 33,
        xtreamId: 503,
        seasonNumber: 2,
        episodeNumber: 1,
        title: 'Signal House - S02E01 - Return',
    }),
] as const;

const GROUP: DownloadSeriesCardViewModel = {
    kind: 'series',
    key: 'series:playlist-series:88',
    representative: MEMBERS[2],
    members: MEMBERS,
    seriesXtreamId: 88,
    title: 'Signal House',
    posterUrl: 'https://media.example.test/signal-house.jpg',
    newestTimestamp: 3,
    sourceName: 'Series source',
    trackedBytes: 4_500_000,
    firstSeason: 1,
    lastSeason: 2,
};

describe('DownloadedSeriesDialogComponent', () => {
    let fixture: ComponentFixture<DownloadedSeriesDialogComponent>;
    let component: DownloadedSeriesDialogComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                DownloadedSeriesDialogComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [{ provide: MAT_DIALOG_DATA, useValue: GROUP }],
        }).compileComponents();

        TestBed.inject(TranslateService).setTranslation('en', TRANSLATIONS);
        TestBed.inject(TranslateService).use('en');
        fixture = TestBed.createComponent(DownloadedSeriesDialogComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
    });

    function rows(): HTMLElement[] {
        return Array.from(
            fixture.nativeElement.querySelectorAll(
                '[data-test-id^="downloaded-series-episode-"]'
            )
        );
    }

    function button(row: ParentNode, label: string): HTMLButtonElement {
        const result = Array.from(row.querySelectorAll('button')).find(
            (candidate) => candidate.getAttribute('aria-label') === label
        );
        if (!result) {
            throw new Error(`Missing button: ${label}`);
        }
        return result as HTMLButtonElement;
    }

    async function click(element: HTMLElement): Promise<void> {
        element.click();
        await fixture.whenStable();
    }

    it('renders members in view-model order with their episode identities', () => {
        expect(rows().map((row) => row.getAttribute('data-test-id'))).toEqual([
            'downloaded-series-episode-31',
            'downloaded-series-episode-32',
            'downloaded-series-episode-33',
        ]);
        expect(rows()[0].textContent).toContain('S01E01');
        expect(rows()[1].textContent).toContain('S01E03');
        expect(rows()[2].textContent).toContain('S02E01');
    });

    it('includes the concrete episode identity in every action name', () => {
        rows().forEach((row, index) => {
            const identity = ['S01E01', 'S01E03', 'S02E01'][index];
            const labels = Array.from(
                row.querySelectorAll(
                    '.downloaded-series-dialog__actions button'
                )
            ).map((candidate) => candidate.getAttribute('aria-label'));

            expect(labels).toHaveLength(4);
            expect(labels.every((label) => label?.includes(identity))).toBe(
                true
            );
        });
    });

    it('emits play, reveal, copy, and remove with the selected member', async () => {
        const selected = MEMBERS[1];
        const row = rows()[1];
        const actions: unknown[] = [];
        component.itemAction.subscribe((action) => actions.push(action));

        await click(
            button(row, 'Play: S01E03 — Signal House - S01E03 - Relay')
        );
        await click(
            button(
                row,
                'Show in folder: S01E03 — Signal House - S01E03 - Relay'
            )
        );
        await click(
            button(
                row,
                'Copy download URL: S01E03 — Signal House - S01E03 - Relay'
            )
        );
        await click(
            button(
                row,
                'Remove from manager: S01E03 — Signal House - S01E03 - Relay'
            )
        );

        expect(actions).toEqual([
            { type: 'play', item: selected },
            { type: 'reveal', item: selected },
            { type: 'copy-url', item: selected },
            { type: 'remove', item: selected },
        ]);
    });
});
