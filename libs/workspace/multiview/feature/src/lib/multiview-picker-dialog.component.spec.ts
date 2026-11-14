import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import { ConnectionBudgetService } from './connection-budget.service';
import {
    MultiviewPickerMemory,
    type MultiviewPickerDialogData,
} from './multiview-picker-context';
import { MultiviewPickerDataService } from './multiview-picker-data.service';
import { MultiviewPickerDialogComponent } from './multiview-picker-dialog.component';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import { EMPTY_PICKER_SEARCH } from './multiview-picker-search';
import { MultiviewPickerSearchService } from './multiview-picker-search.service';
import { composePickerSections } from './multiview-picker-sections';
import { MultiviewSeriesEpisodesService } from './multiview-series-episodes.service';
import { MultiviewTileResolverService } from './multiview-tile-resolver';

const series = movieItem(30, { contentType: 'series', name: 'Synthetic Show' });

let withContinue = true;

function sections(onScreen: UnifiedCollectionItem | null = null) {
    return composePickerSections({
        favorites: [liveItem(1)],
        recent: [liveItem(2), series],
        continueItems: withContinue
            ? [
                  {
                      item: movieItem(40),
                      position: {
                          contentXtreamId: 40,
                          contentType: 'vod',
                          positionSeconds: 60,
                      },
                  },
              ]
            : [],
        playlist: [liveItem(2), liveItem(3)],
        isAllowed: () => true,
        toRow: (item) => ({
            ...toPickerRow(item, []),
            inTile: item.uid === onScreen?.uid ? 1 : null,
        }),
    });
}

describe('MultiviewPickerDialogComponent', () => {
    let fixture: ComponentFixture<MultiviewPickerDialogComponent>;
    const close = jest.fn();
    const data = {
        load: jest.fn(),
        loadEpg: jest.fn(),
        programFor: jest.fn(),
    };
    const search = { search: jest.fn() };
    const resolver = { resolve: jest.fn() };
    const episodes = { load: jest.fn(), resolve: jest.fn() };
    const budgetFor = jest.fn();

    async function open(
        context: Partial<MultiviewPickerDialogData> = {},
        onScreen: UnifiedCollectionItem | null = null
    ): Promise<void> {
        data.load.mockResolvedValue({
            sections: sections(onScreen),
            playlistGroups: [
                { id: 'g1', name: 'Synthetic News' },
                { id: 'g2', name: 'Synthetic Sport' },
            ],
            playlistRowGroups: new Map([
                [toPickerRow(liveItem(2), []).sessionKey, 'g1'],
                [toPickerRow(liveItem(3), []).sessionKey, 'g2'],
            ]),
            playlistPaged: false,
        });
        TestBed.configureTestingModule({
            imports: [
                MultiviewPickerDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MatDialogRef, useValue: { close } },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        request: { context: 'add' },
                        mainTitle: 'Synthetic Film',
                        mainKind: 'vod',
                        playlistId: 'playlist-1',
                        replaceNumber: null,
                        replaceTitle: null,
                        ...context,
                    },
                },
                { provide: MultiviewPickerDataService, useValue: data },
                { provide: MultiviewPickerSearchService, useValue: search },
                { provide: MultiviewTileResolverService, useValue: resolver },
                { provide: MultiviewSeriesEpisodesService, useValue: episodes },
                { provide: ConnectionBudgetService, useValue: { budgetFor } },
                {
                    provide: PlaylistsService,
                    useValue: {
                        getPlaylistById: () =>
                            of({
                                _id: 'playlist-1',
                                title: 'Synthetic Provider',
                                serverUrl: 'http://xtream.example',
                            }),
                    },
                },
                {
                    provide: MultiviewOnScreenSources,
                    useValue: { current: () => [] },
                },
            ],
        });
        fixture = TestBed.createComponent(MultiviewPickerDialogComponent);
        await settle();
    }

    async function settle(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            fixture.detectChanges();
            await fixture.whenStable();
            await new Promise((resolve) => setTimeout(resolve));
        }
        fixture.detectChanges();
    }

    beforeEach(() => {
        jest.resetAllMocks();
        withContinue = true;
        data.loadEpg.mockResolvedValue(new Map());
        data.programFor.mockReturnValue(null);
        budgetFor.mockResolvedValue({
            playlistName: 'Synthetic Provider',
            maxConnections: 2,
            activeConnections: 1,
        });
    });

    afterEach(() => fixture?.destroy());

    const host = (): HTMLElement => fixture.nativeElement;
    const text = () => host().textContent ?? '';
    const input = () =>
        host().querySelector(
            '[data-test-id="multiview-picker-search"]'
        ) as HTMLInputElement;
    const rows = () =>
        Array.from(host().querySelectorAll('app-multiview-picker-row'));
    const key = (name: string, target: EventTarget = input()) =>
        target.dispatchEvent(
            new KeyboardEvent('keydown', { key: name, bubbles: true })
        );

    it('titles the add context after the main tile', async () => {
        await open();

        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.TITLE_ADD');
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.SUBTITLE_ADD');
    });

    it('titles the replace context after the replaced tile', async () => {
        await open({
            request: { context: 'replace', tileId: 'multiview-tile-2' },
            replaceNumber: 2,
            replaceTitle: 'Synthetic News',
        });

        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.TITLE_REPLACE');
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.SUBTITLE_REPLACE');
    });

    it('opens on Live now next to a film, favourites first', async () => {
        await open();

        expect(
            host()
                .querySelector('[aria-current="true"]')
                ?.getAttribute('data-test-id')
        ).toBe('multiview-picker-section-live-now');
        expect(rows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('Synthetic Channel 1'),
            expect.stringContaining('Synthetic Channel 2'),
            expect.stringContaining('Synthetic Channel 3'),
        ]);
    });

    it('opens on Continue next to a channel', async () => {
        await open({ mainKind: 'live' });

        expect(
            host()
                .querySelector('[aria-current="true"]')
                ?.getAttribute('data-test-id')
        ).toBe('multiview-picker-section-continue');
    });

    it('opens on Live now when Continue is empty and nothing was chosen yet', async () => {
        withContinue = false;
        await open({ mainKind: 'live' });

        expect(
            host()
                .querySelector('[aria-current="true"]')
                ?.getAttribute('data-test-id')
        ).toBe('multiview-picker-section-live-now');
    });

    it('lists the current playlist with its budget badge and footer meter', async () => {
        await open();

        const playlist = host().querySelector(
            '[data-test-id="multiview-picker-section-playlist"]'
        );
        expect(playlist?.textContent).toContain('Synthetic Provider');
        expect(playlist?.textContent).toContain('Xtream');
        expect(playlist?.textContent).toContain(
            'PLAYER.MULTIVIEW.PICKER.BUDGET_FREE'
        );
        expect(
            host().querySelectorAll('.mv-picker__segments span')
        ).toHaveLength(2);
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.METER');
    });

    it('keeps a full playlist selectable and warns above its list', async () => {
        budgetFor.mockResolvedValue({
            playlistName: 'Synthetic Provider',
            maxConnections: 1,
            activeConnections: 1,
        });
        await open();

        (
            host().querySelector(
                '[data-test-id="multiview-picker-section-playlist"]'
            ) as HTMLButtonElement
        ).click();
        await settle();

        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.BUDGET_FULL');
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.FULL_WARNING');
        expect(rows()).toHaveLength(2);
    });

    it('filters the playlist by the category menu', async () => {
        await open();
        (
            host().querySelector(
                '[data-test-id="multiview-picker-section-playlist"]'
            ) as HTMLButtonElement
        ).click();
        await settle();
        expect(rows()).toHaveLength(2);

        (
            host().querySelector(
                '[data-test-id="multiview-picker-category"]'
            ) as HTMLButtonElement
        ).click();
        await settle();
        const sport = Array.from(
            document.querySelectorAll('[mat-menu-item]')
        ).find((item) => item.textContent?.includes('Synthetic Sport')) as
            HTMLButtonElement | undefined;
        sport?.click();
        await settle();

        expect(rows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('Synthetic Channel 3'),
        ]);
        expect(
            host().querySelector('[data-test-id="multiview-picker-category"]')
                ?.textContent
        ).toContain('Synthetic Sport');
    });

    it('moves with the arrows, skipping a row already on screen, and adds with Enter', async () => {
        const source = { playbackSessionKey: 'picked' };
        resolver.resolve.mockResolvedValue(source);
        await open({}, liveItem(2));

        expect(input().getAttribute('aria-activedescendant')).toBe(
            rows()[0].id
        );
        key('ArrowDown');
        await settle();
        expect(input().getAttribute('aria-activedescendant')).toBe(
            rows()[2].id
        );
        expect(rows()[1].getAttribute('aria-disabled')).toBe('true');

        key('Enter');
        await settle();

        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({ item: liveItem(3) })
        );
        expect(close).toHaveBeenCalledWith({ source, item: liveItem(3) });
    });

    it('scrolls the active row into view as the arrows move', async () => {
        const scrolled: string[] = [];
        const original = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
            scrolled.push(this.id);
        };
        try {
            await open();
            key('ArrowDown');
            await settle();

            expect(scrolled).toContain(rows()[1].id);
        } finally {
            HTMLElement.prototype.scrollIntoView = original;
        }
    });

    it('ignores a click on a row already on screen', async () => {
        await open({}, liveItem(1));

        (rows()[0] as HTMLElement).click();
        await settle();

        expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('stays open and says so when a source cannot be opened', async () => {
        resolver.resolve.mockRejectedValue(new Error('locked'));
        await open();

        (rows()[0] as HTMLElement).click();
        await settle();

        expect(close).not.toHaveBeenCalled();
        expect(rows()[0].textContent).toContain(
            'PLAYER.MULTIVIEW.PICKER.RESOLVE_ERROR'
        );
    });

    it('sends typing anywhere to the search', async () => {
        await open();
        const nav = host().querySelector(
            '[data-test-id="multiview-picker-section-recent"]'
        ) as HTMLElement;

        key('f', nav);

        expect(document.activeElement).toBe(input());
    });

    it('shows search results in groups', async () => {
        search.search.mockResolvedValue({
            ...EMPTY_PICKER_SEARCH,
            channels: [toPickerRow(liveItem(3), [])],
        });
        await open();
        input().value = 'channel 3';
        input().dispatchEvent(new Event('input'));
        fixture.detectChanges();
        // The search waits for typing to pause (200 ms).
        await new Promise((resolve) => setTimeout(resolve, 260));
        await settle();

        expect(search.search).toHaveBeenCalledWith(
            'channel 3',
            expect.any(Array),
            'playlist-1'
        );
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.SEARCH_CHANNELS');
        expect(rows()).toHaveLength(1);
    });

    it('keeps the results of the newest search when the scope changes', async () => {
        let finishWide: (value: unknown) => void = () => undefined;
        search.search
            .mockImplementationOnce(
                () => new Promise((resolve) => (finishWide = resolve))
            )
            .mockResolvedValue({
                ...EMPTY_PICKER_SEARCH,
                channels: [toPickerRow(liveItem(3), [])],
            });
        await open();
        input().value = 'channel';
        input().dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve, 260));
        (
            host().querySelector(
                '[data-test-id="multiview-picker-section-playlist"]'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve, 260));
        await settle();
        finishWide({
            ...EMPTY_PICKER_SEARCH,
            channels: [
                toPickerRow(liveItem(1), []),
                toPickerRow(liveItem(2), []),
            ],
        });
        await settle();

        expect(rows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('Synthetic Channel 3'),
        ]);
    });

    it('finds programmes of the loaded EPG in search (On air now)', async () => {
        data.programFor.mockImplementation((item: UnifiedCollectionItem) =>
            item.xtreamId === 3 ? { title: 'Synthetic Final' } : null
        );
        search.search.mockImplementation(
            async (_term: string, rows: { program: unknown }[]) => ({
                ...EMPTY_PICKER_SEARCH,
                onAir: rows.filter((row) => row.program),
            })
        );
        await open();
        input().value = 'final';
        input().dispatchEvent(new Event('input'));
        fixture.detectChanges();
        await new Promise((resolve) => setTimeout(resolve, 260));
        await settle();

        const [, rows] = search.search.mock.calls.at(-1) as [
            string,
            {
                item: UnifiedCollectionItem;
                program: { title: string } | null;
            }[],
        ];
        expect(
            rows.find((row) => row.item.xtreamId === 3)?.program?.title
        ).toBe('Synthetic Final');
        expect(text()).toContain('PLAYER.MULTIVIEW.PICKER.SEARCH_ON_AIR');
    });

    it('opens the episodes of a series and adds the picked one', async () => {
        const episode = {
            sessionKey: 'episode-1',
            season: 1,
            number: 2,
            title: 'Synthetic Episode',
            position: null,
            inTile: null,
            episode: {},
        };
        episodes.load.mockResolvedValue([episode]);
        episodes.resolve.mockResolvedValue({ playbackSessionKey: 'episode-1' });
        await open();
        (
            host().querySelector(
                '[data-test-id="multiview-picker-section-recent"]'
            ) as HTMLButtonElement
        ).click();
        await settle();

        (rows()[1] as HTMLElement).click();
        await settle();
        expect(text()).toContain('Synthetic Episode');

        key('Enter');
        await settle();

        expect(episodes.resolve).toHaveBeenCalledWith(series, episode);
        expect(close).toHaveBeenCalledWith({
            source: { playbackSessionKey: 'episode-1' },
            item: series,
        });
    });

    it('remembers the section chosen last', async () => {
        await open();
        (
            host().querySelector(
                '[data-test-id="multiview-picker-section-favorites"]'
            ) as HTMLButtonElement
        ).click();

        expect(TestBed.inject(MultiviewPickerMemory).lastSection).toBe(
            'favorites'
        );
    });
});
