import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import type {
    EpgItemDialogAction,
    EpgItemDialogData,
} from '../epg-item-description/epg-item-description.component';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { EpgGuideComponent } from './epg-guide.component';
import {
    EPG_GUIDE_DENSITY_KEY,
    EPG_GUIDE_ONLY_WITH_EPG_KEY,
} from './epg-guide-preferences';
import { EpgGuideToolbarComponent } from './epg-guide-toolbar.component';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideSearchHit,
    EpgGuideSource,
} from './epg-guide-source';

function channel(
    id: string,
    epgKey: string | null = id,
    number = 1
): EpgGuideChannel {
    return { id, number, name: `Channel ${id}`, logoUrl: null, epgKey };
}

function nowProgram(channelId: string): EpgProgram {
    const start = new Date(Date.now() - 10 * 60_000);
    const stop = new Date(Date.now() + 20 * 60_000);
    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        channel: channelId,
        title: `${channelId} now`,
        desc: null,
        category: null,
    };
}

function keydown(key: string, target?: EventTarget): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    if (target) {
        Object.defineProperty(event, 'target', { value: target });
    }
    return event;
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
}

describe('EpgGuideComponent', () => {
    let fixture: ComponentFixture<EpgGuideComponent>;
    let component: EpgGuideComponent;
    const channels = signal<EpgGuideChannel[]>([]);
    const activeChannelId = signal<string | null>(null);
    const livePlayback = signal(true);
    const offsetMinutes = signal(0);
    const searchHits = signal<EpgGuideSearchHit[]>([]);
    const revision = signal(0);
    let schedule: EpgProgram[];
    let covered: Set<string>;
    const activate = jest.fn();
    const setScope = jest.fn();
    const dialogOpen = jest.fn<
        Observable<EpgItemDialogAction | undefined>,
        [EpgItemDialogData]
    >(() => of(undefined));

    beforeEach(() => {
        localStorage.clear();
        offsetMinutes.set(0);
        searchHits.set([]);
        revision.set(0);
        schedule = [nowProgram('a')];
        covered = new Set(['a']);
        activate.mockReset();
        setScope.mockReset();
        dialogOpen.mockClear();
        channels.set([
            channel('a', 'a', 1),
            channel('b', null, 2),
            channel('c', 'c', 3),
        ]);
        activeChannelId.set('a');
        livePlayback.set(true);
        const source: EpgGuideSource = {
            channels,
            revision,
            scopes: signal([{ id: 'all', label: 'All channels', kind: 'all' }]),
            scopeId: signal('all'),
            setScope,
            loadPrograms: async (window) =>
                new Map(
                    window.channels.map((item) => [
                        item.id,
                        schedule.filter(
                            (program) => program.channel === item.id
                        ),
                    ])
                ),
            loadCoverage: async () => covered,
            activeChannelId,
            livePlayback,
            activate,
            searchPrograms: async () => searchHits(),
        };
        TestBed.configureTestingModule({
            imports: [EpgGuideComponent],
            providers: [
                { provide: EPG_GUIDE_SOURCE, useValue: source },
                {
                    provide: EpgProgrammeDialogService,
                    useValue: { open: dialogOpen },
                },
                { provide: MatDialog, useValue: { openDialogs: [] } },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: offsetMinutes },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        // Plain subjects: `TranslatePipe` reads `event.lang`
                        // off every emission, so a replayed `null` would throw
                        // inside its subscriber on the first render.
                        onLangChange: new Subject(),
                        onTranslationChange: new Subject(),
                        onDefaultLangChange: new Subject(),
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                    },
                },
            ],
        });
        fixture = TestBed.createComponent(EpgGuideComponent);
        component = fixture.componentInstance;
    });

    it('offers explicit replay without replaying an active channel on click', async () => {
        await settle(fixture);
        const row = component.rows()[0];
        const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
        const retry = jest.fn(() => true);
        source.retryActive = retry;

        component.activateRow(row);
        expect(retry).not.toHaveBeenCalled();
        component.commitRow(row);
        expect(retry).toHaveBeenCalledWith(row, component.rows());
        expect(activate).not.toHaveBeenCalled();
    });

    it('retunes the active channel on click while its previous stream is stopping', async () => {
        await settle(fixture);
        const row = component.rows()[0];
        const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
        const stopping = signal(false);
        Object.assign(source, {
            closeOnPlaybackConfirmation: true,
            canRetuneActive: stopping,
        });

        component.pointerRow(row);
        expect(activate).not.toHaveBeenCalled();
        stopping.set(true);
        component.pointerRow(row);
        expect(activate).toHaveBeenCalledWith(
            row.id,
            row.epgKey,
            component.rows(),
            expect.any(Function)
        );
    });

    it('passes the displayed row order when activating a filtered channel', async () => {
        await settle(fixture);
        component.setFilter('channel c');
        const rows = component.rows();
        component.activateRow(rows[0]);
        expect(activate).toHaveBeenCalledWith('c', rows[0].epgKey, rows);
        expect(rows.map((row) => row.id)).toEqual(['c']);
    });

    it('lists the scope channels in order and marks the active one', async () => {
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a', 'b', 'c']);
        expect(component.activeRowIndex()).toBe(0);
    });

    it('emits activate on click and activate + close on double click / Enter', async () => {
        await settle(fixture);
        const close = jest.fn();
        component.close.subscribe(close);
        activate.mockImplementation((id: string) => activeChannelId.set(id));
        component.pointerRow(component.rows()[2]);
        expect(activate).toHaveBeenCalledWith(
            'c',
            component.rows()[2].epgKey,
            component.rows()
        );
        expect(close).not.toHaveBeenCalled();
        // The row reports the first click and then the double-click commit.
        component.pointerRow(component.rows()[2], false);
        expect(activate).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        // Enter plays the active row ('c' by now): it is already playing, so
        // only the close fires.
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(activate).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(2);
    });

    it.each([0, 2])(
        'keeps a committed channel visible until its host confirms playback (%s)',
        async (index) => {
            await settle(fixture);
            const close = jest.fn();
            component.close.subscribe(close);
            const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
            Object.assign(source, { closeOnPlaybackConfirmation: true });
            const row = component.rows()[index];
            component.commitRow(row);
            expect(close).not.toHaveBeenCalled();
            const confirm = (
                activate.mock.lastCall as unknown[]
            )[3] as () => void;
            confirm();
            expect(close).toHaveBeenCalledTimes(1);
        }
    );

    it.each([false, true])(
        'uses the same tune for double-click, including when it confirms early (%s)',
        async (early) => {
            await settle(fixture);
            const close = jest.fn();
            component.close.subscribe(close);
            const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
            Object.assign(source, { closeOnPlaybackConfirmation: true });
            const row = component.rows()[2];
            component.pointerRow(row);
            const confirm = (
                activate.mock.lastCall as unknown[]
            )[3] as () => void;
            if (early) confirm();
            expect(close).not.toHaveBeenCalled();
            component.pointerRow(row, false);
            expect(activate).toHaveBeenCalledTimes(1);
            if (!early) {
                expect(close).not.toHaveBeenCalled();
                confirm();
            }
            expect(close).toHaveBeenCalledTimes(1);
        }
    );

    it('hides only uncovered rows when "Only with EPG" is on, after coverage arrived', async () => {
        await settle(fixture);
        component.setOnlyWithEpg(true);
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a']);
        expect(localStorage.getItem(EPG_GUIDE_ONLY_WITH_EPG_KEY)).toBe('1');
    });

    it('filters by channel name and clears', async () => {
        await settle(fixture);
        component.setFilter('channel c');
        expect(component.rows().map((row) => row.id)).toEqual(['c']);
        expect(component.rows()[0].number).toBe(3);
        component.setFilter('');
        expect(component.rows()).toHaveLength(3);
    });

    it('numbers portal rows by their position in the queue after both filters', async () => {
        const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
        Object.assign(source, { numberByDisplayedOrder: true });
        covered = new Set(['c']);
        schedule = [nowProgram('c')];
        await settle(fixture);
        component.setFilter('channel c');
        expect(component.rows().map(({ id, number }) => [id, number])).toEqual([
            ['c', 1],
        ]);
        component.setFilter('');
        component.setOnlyWithEpg(true);
        await settle(fixture);
        expect(component.rows().map(({ id, number }) => [id, number])).toEqual([
            ['c', 1],
        ]);
    });

    it('persists density and zoom and restores them', async () => {
        await settle(fixture);
        component.setDensity('compact');
        component.setZoom(9_999);
        await settle(fixture);
        expect(localStorage.getItem(EPG_GUIDE_DENSITY_KEY)).toBe('compact');
        expect(component.zoom()).toBe(480);
        expect(component.rowHeightPx()).toBe(44);
    });

    it.each([0, 2])(
        'forwards Watch Live from programme details for row %s',
        async (index) => {
            await settle(fixture);
            dialogOpen.mockReturnValueOnce(of('live'));
            const row = component.rows()[index];
            if (index === 0) {
                const source =
                    fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
                source.canRetuneActive = (watchLive) => watchLive === true;
                component.activateRow(row);
                expect(activate).not.toHaveBeenCalled();
            }
            const item = {
                kind: 'block' as const,
                key: 'k',
                block: {
                    program: nowProgram('a'),
                    key: 'k',
                    startMs: 0,
                    stopMs: 1,
                    when: 'past' as const,
                    offsetMin: 0,
                    durationMin: 1,
                },
                leftPx: 0,
                widthPx: 10,
                tier: 'wide' as const,
                nowFillPercent: 0,
                canCatchUp: false,
            };
            component.openDetails(row, item);
            expect(dialogOpen).toHaveBeenCalledWith(
                expect.objectContaining({
                    channelName: row.name,
                    primaryAction: null,
                    archiveUnavailableNote: true,
                }),
                expect.any(AbortSignal)
            );
            expect(activate).toHaveBeenCalledWith(
                row.id,
                row.epgKey,
                component.rows()
            );
        }
    );

    it('re-activates the active row while catch-up plays, so the host can return to live', async () => {
        livePlayback.set(false);
        await settle(fixture);
        component.activateRow(component.rows()[0]);
        expect(activate).toHaveBeenCalledWith(
            'a',
            component.rows()[0].epgKey,
            component.rows()
        );
        livePlayback.set(true);
        activate.mockClear();
        component.activateRow(component.rows()[0]);
        expect(activate).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'preserves programme results only for a catalogue search on scope change (%s)',
        async (searchAcrossScopes) => {
            const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
            Object.assign(source, { searchAcrossScopes });
            const hit = {
                channelId: 'a',
                channelEpgKey: 'synthetic-exact-copy',
                program: nowProgram('a'),
            };
            searchHits.set([hit]);
            await settle(fixture);
            component.onSearchQueryChange('news');
            await new Promise((resolve) => setTimeout(resolve, 400));
            await settle(fixture);
            expect(component.searchQuery()).toBe('news');
            expect(component.searchResults()).toEqual([hit]);
            component.setScope('favorites');
            expect(component.searchQuery()).toBe(
                searchAcrossScopes ? 'news' : ''
            );
            expect(component.searchResults()).toEqual(
                searchAcrossScopes ? [hit] : []
            );
            expect(setScope).toHaveBeenCalledWith('favorites');
        }
    );

    it('keeps the query and restarts search when the guide source is refreshed', async () => {
        await settle(fixture);
        component.onSearchQueryChange('synthetic');
        revision.update((value) => value + 1);
        fixture.detectChanges();
        expect(component.searchQuery()).toBe('synthetic');
        expect(component.searchStatus()).toBe('loading');
    });

    it('closes on Escape and steps days with PageUp/PageDown', async () => {
        await settle(fixture);
        const close = jest.fn();
        component.close.subscribe(close);
        const before = component.dayKey();
        component.onKeydown(new KeyboardEvent('keydown', { key: 'PageDown' }));
        expect(component.dayKey()).not.toBe(before);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(close).toHaveBeenCalled();
        expect(
            fixture.debugElement.query(By.css('app-epg-guide-toolbar'))
        ).toBeTruthy();
    });

    it('ignores guide keys aimed at a toolbar control', async () => {
        await settle(fixture);
        const close = jest.fn();
        component.close.subscribe(close);
        activate.mockClear();
        const button: HTMLButtonElement = fixture.debugElement.query(
            By.css('app-epg-guide-toolbar button')
        ).nativeElement;
        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            cancelable: true,
        });
        Object.defineProperty(event, 'target', { value: button });

        component.onKeydown(event);

        expect(activate).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('handles grid keys only for its own targets, but closes from anywhere', async () => {
        await settle(fixture);
        const viewportEl: HTMLElement = fixture.debugElement.query(
            By.css('cdk-virtual-scroll-viewport')
        ).nativeElement;
        viewportEl.scrollTo = jest.fn() as unknown as HTMLElement['scrollTo'];
        const close = jest.fn();
        component.close.subscribe(close);
        const outside = document.createElement('div');
        document.body.appendChild(outside);

        // A non-interactive surface outside the guide — the docked player, the
        // header — keeps its keys: nothing moves, nothing is consumed.
        const foreign = keydown('ArrowDown', outside);
        component.onKeydown(foreign);
        expect(component.focus()).toBeNull();
        expect(foreign.defaultPrevented).toBe(false);

        // Nothing focused: the state right after the `G` shortcut opened it.
        component.onKeydown(keydown('ArrowDown', document.body));
        expect(component.focus()).toEqual({ row: 1, block: null });

        const cell: HTMLElement = fixture.debugElement.query(
            By.css('.epg-guide-row__channel')
        ).nativeElement;
        const own = keydown('ArrowDown', cell);
        component.onKeydown(own);
        expect(component.focus()).toEqual({ row: 2, block: null });
        expect(own.defaultPrevented).toBe(true);

        // Escape is the documented close key wherever the focus is.
        component.onKeydown(keydown('Escape', outside));
        expect(close).toHaveBeenCalled();
        outside.remove();
    });

    it('moves the roving focus with its channel and then to a surviving row', async () => {
        schedule.push(nowProgram('c'));
        covered.add('c');
        await settle(fixture);
        component.focusCell(2, 0);
        await settle(fixture);
        expect(component.focus()).toEqual({ row: 2, block: 0 });

        // An uncovered channel above 'c' disappears from the visible rows.
        component.setOnlyWithEpg(true);
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a', 'c']);
        expect(component.focus()).toEqual({ row: 1, block: 0 });
        const card = fixture.nativeElement.querySelector(
            '.epg-guide-row__block[tabindex="0"]'
        ) as HTMLElement;
        expect(document.activeElement).toBe(card);
        component.onKeydown(keydown('i', card));
        expect(dialogOpen).toHaveBeenCalledWith(
            expect.objectContaining({ channelName: 'Channel c' }),
            expect.any(AbortSignal)
        );

        // Move to a surviving channel when a filter hides the focused row.
        component.setOnlyWithEpg(false);
        component.setFilter('channel b');
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['b']);
        expect(component.focus()).toEqual({ row: 0, block: null });

        // Undoing the filter follows the new focused channel.
        component.setFilter('');
        await settle(fixture);
        expect(component.focus()).toEqual({ row: 1, block: null });
    });

    it('opens a search hit with its own channel and focuses that row', async () => {
        await settle(fixture);
        // Revealing the row scrolls the CDK viewport; jsdom has no scrollTo.
        const viewportEl: HTMLElement = fixture.debugElement.query(
            By.css('cdk-virtual-scroll-viewport')
        ).nativeElement;
        viewportEl.scrollTo = jest.fn() as unknown as HTMLElement['scrollTo'];

        component.openSearchResult({
            channelId: 'c',
            program: nowProgram('c'),
        });
        expect(dialogOpen).toHaveBeenCalledWith(
            expect.objectContaining({ channelName: 'Channel c' }),
            expect.any(AbortSignal)
        );
        expect(component.focus()).toEqual({ row: 2, block: null });

        dialogOpen.mockClear();
        component.openSearchResult({
            channelId: null,
            program: nowProgram('x'),
        });
        expect(dialogOpen).toHaveBeenCalledWith(
            expect.not.objectContaining({ channelName: expect.anything() }),
            expect.any(AbortSignal)
        );
    });

    it('clears the channel filter on Escape inside the toolbar field, then lets Escape through', async () => {
        await settle(fixture);
        component.setFilter('channel c');
        await settle(fixture);
        const toolbar = fixture.debugElement.query(
            By.directive(EpgGuideToolbarComponent)
        );
        const input: HTMLInputElement = toolbar.query(
            By.css('.guide-toolbar__input input')
        ).nativeElement;
        const cleared = jest.fn();
        toolbar.componentInstance.filterChange.subscribe(cleared);
        const blur = jest.spyOn(input, 'blur');

        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(cleared).toHaveBeenCalledWith('');
        expect(blur).not.toHaveBeenCalled();

        component.setFilter('');
        await settle(fixture);
        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(blur).toHaveBeenCalled();
    });

    it('keeps one tabbable grid cell and follows the keyboard with DOM focus', async () => {
        await settle(fixture);
        const viewportEl: HTMLElement = fixture.debugElement.query(
            By.css('cdk-virtual-scroll-viewport')
        ).nativeElement;
        viewportEl.scrollTo = jest.fn() as unknown as HTMLElement['scrollTo'];
        const cells = (): HTMLElement[] =>
            fixture.debugElement
                .queryAll(By.css('.epg-guide-row__channel'))
                .map((cell) => cell.nativeElement as HTMLElement);

        // Nothing focused yet: the playing row is the grid's Tab stop.
        expect(cells().map((cell) => cell.getAttribute('tabindex'))).toEqual([
            '0',
            '-1',
            '-1',
        ]);

        component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        await settle(fixture);

        expect(component.focus()).toEqual({ row: 1, block: null });
        expect(cells().map((cell) => cell.getAttribute('tabindex'))).toEqual([
            '-1',
            '0',
            '-1',
        ]);
        expect(document.activeElement).toBe(cells()[1]);

        // A filter that drops the focused row must not leave the grid without
        // a Tab stop: it falls back to the playing row.
        component.setOnlyWithEpg(true);
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['a']);
        expect(cells().map((cell) => cell.getAttribute('tabindex'))).toEqual([
            '0',
        ]);
        expect(document.activeElement).toBe(cells()[0]);
        component.setFilter('synthetic unmatched channel');
        await settle(fixture);
        expect(viewportEl.getAttribute('tabindex')).toBe('0');
        expect(document.activeElement).toBe(viewportEl);
    });

    it.each([
        [true, false, false],
        [false, false, false],
        [true, true, false],
        [false, true, false],
        [true, false, true],
        [false, true, true],
    ] as const)(
        'restores focus after a programme reload (present: %s, row moved: %s, first load fails: %s)',
        async (present, moved, failed) => {
            await settle(fixture);
            const card = fixture.nativeElement.querySelector(
                '.epg-guide-row__block'
            ) as HTMLElement;
            component.focusCell(0, 0);
            await settle(fixture);
            card.focus();
            expect(document.activeElement).toBe(card);

            const source = fixture.debugElement.injector.get(EPG_GUIDE_SOURCE);
            const load = source.loadPrograms;
            let fail = failed;
            let release!: () => void;
            const reload = new Promise<void>((resolve) => {
                release = resolve;
            });
            jest.spyOn(source, 'loadPrograms').mockImplementation(
                async (window) => {
                    await reload;
                    if (fail) throw new Error('Synthetic schedule failure');
                    return load(window);
                }
            );
            if (!present) schedule = [];
            if (moved)
                channels.set([channels()[1], channels()[0], channels()[2]]);
            const row = moved ? 1 : 0;
            revision.update((value) => value + 1);
            fixture.detectChanges();
            expect(component.focus()).toEqual({ row, block: 0 });
            expect(component.focusedBlockFor(row)).toBeNull();
            release();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            await settle(fixture);
            if (failed) {
                expect(component.statusFor(channels()[row].id)).toBe('error');
                expect(component.focus()).toEqual({ row, block: 0 });
                expect(component.focusedBlockFor(row)).toBeNull();
                fail = false;
                revision.update((value) => value + 1);
                fixture.detectChanges();
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                await settle(fixture);
                expect(component.statusFor(channels()[row].id)).toBe('loaded');
            }

            const target = fixture.nativeElement
                .querySelectorAll('app-epg-guide-row')
                [row].querySelector(
                    present
                        ? '.epg-guide-row__block'
                        : '.epg-guide-row__channel'
                ) as HTMLElement;
            expect(card.isConnected).toBe(false);
            expect(target.getAttribute('tabindex')).toBe('0');
            expect(document.activeElement).toBe(target);
        }
    );

    it('jumps to now on N without scrolling back to a focus left off-screen', async () => {
        await settle(fixture);
        const viewportEl: HTMLElement = fixture.debugElement.query(
            By.css('cdk-virtual-scroll-viewport')
        ).nativeElement;
        const scrollTo = jest.fn();
        viewportEl.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
        // jsdom reports a zero-sized lane, so this programme counts as hidden.
        component.focusCell(0, 0);
        await settle(fixture);
        scrollTo.mockClear();

        component.onKeydown(keydown('n'));

        // One combined smooth scroll; a reveal after it would cancel it. The
        // focus follows the jump to the playing row.
        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(scrollTo).toHaveBeenCalledWith(
            expect.objectContaining({ top: 0, behavior: 'smooth' })
        );
        expect(component.focus()).toEqual({ row: 0, block: null });
    });

    it('moves the roving focus to a clicked programme card', async () => {
        await settle(fixture);
        const card = fixture.debugElement.query(
            By.css('app-epg-guide-row .epg-guide-row__block')
        );
        expect(card).toBeTruthy();

        card.nativeElement.click();
        await settle(fixture);

        expect(component.focus()).toEqual({ row: 0, block: 0 });
        expect(card.nativeElement.getAttribute('tabindex')).toBe('0');
    });

    it('renders search hits at the display-offset time', async () => {
        offsetMinutes.set(60);
        const program = nowProgram('a');
        searchHits.set([{ channelId: 'a', program }]);
        await settle(fixture);

        expect(component.searchHitStartMs({ channelId: 'a', program })).toBe(
            Date.parse(program.start) + 60 * 60_000
        );

        component.onSearchQueryChange('now');
        // The controller debounces for 300ms before it asks the host.
        await new Promise((resolve) => setTimeout(resolve, 400));
        await settle(fixture);

        const shifted = new Date(Date.parse(program.start) + 60 * 60_000);
        const pad = (value: number) => `${value}`.padStart(2, '0');
        expect(
            fixture.debugElement.query(By.css('.epg-guide__search-meta'))
                .nativeElement.textContent
        ).toContain(`${pad(shifted.getHours())}:${pad(shifted.getMinutes())}`);
    });
});
