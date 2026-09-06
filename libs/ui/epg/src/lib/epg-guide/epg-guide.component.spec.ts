import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
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
    const activate = jest.fn();
    const setScope = jest.fn();
    const dialogOpen = jest.fn(() => of(undefined));

    beforeEach(() => {
        localStorage.clear();
        offsetMinutes.set(0);
        searchHits.set([]);
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
            scopes: signal([{ id: 'all', label: 'All channels', kind: 'all' }]),
            scopeId: signal('all'),
            setScope,
            loadPrograms: async (window) =>
                new Map(
                    window.channels.map((item) => [
                        item.id,
                        item.id === 'a' ? [nowProgram('a')] : [],
                    ])
                ),
            loadCoverage: async () => new Set(['a']),
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
        component.activateRow(component.rows()[2]);
        expect(activate).toHaveBeenCalledWith('c');
        expect(close).not.toHaveBeenCalled();
        // click, click, dblclick: the second click and the commit must not
        // restart the stream that is already playing.
        component.activateRow(component.rows()[2]);
        component.commitRow(component.rows()[2]);
        expect(activate).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        // Enter plays the active row ('c' by now): it is already playing, so
        // only the close fires.
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(activate).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(2);
    });

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
        component.setFilter('');
        expect(component.rows()).toHaveLength(3);
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

    it('opens the programme dialog for a non-live card and activates on "live"', async () => {
        await settle(fixture);
        dialogOpen.mockReturnValueOnce(of('live'));
        const row = component.rows()[2];
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
                channelName: 'Channel c',
                primaryAction: null,
                archiveUnavailableNote: true,
            })
        );
        expect(activate).toHaveBeenCalledWith('c');
    });

    it('re-activates the active row while catch-up plays, so the host can return to live', async () => {
        livePlayback.set(false);
        await settle(fixture);
        component.activateRow(component.rows()[0]);
        expect(activate).toHaveBeenCalledWith('a');
        livePlayback.set(true);
        activate.mockClear();
        component.activateRow(component.rows()[0]);
        expect(activate).not.toHaveBeenCalled();
    });

    it('drops the programme search when the scope changes', async () => {
        await settle(fixture);
        component.onSearchQueryChange('news');
        expect(component.searchQuery()).toBe('news');
        component.setScope('all');
        expect(component.searchQuery()).toBe('');
        expect(component.searchResults()).toEqual([]);
        expect(setScope).toHaveBeenCalledWith('all');
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

    it('moves the roving focus with its channel and drops it with the row', async () => {
        await settle(fixture);
        component.focusCell(2, 0);
        await settle(fixture);
        expect(component.focus()).toEqual({ row: 2, block: 0 });

        // The first channel disappears: the focus follows 'c' to its new index.
        channels.set([channel('b', null, 2), channel('c', 'c', 3)]);
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['b', 'c']);
        expect(component.focus()).toEqual({ row: 1, block: null });

        // A filter that hides the focused channel clears the focus instead of
        // leaving it pointing at whatever moved into that row.
        component.setFilter('channel b');
        await settle(fixture);
        expect(component.rows().map((row) => row.id)).toEqual(['b']);
        expect(component.focus()).toBeNull();

        // Undoing the filter must not bring the stale focus back.
        component.setFilter('');
        await settle(fixture);
        expect(component.focus()).toBeNull();
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
            expect.objectContaining({ channelName: 'Channel c' })
        );
        expect(component.focus()).toEqual({ row: 2, block: null });

        dialogOpen.mockClear();
        component.openSearchResult({
            channelId: null,
            program: nowProgram('x'),
        });
        expect(dialogOpen).toHaveBeenCalledWith(
            expect.not.objectContaining({ channelName: expect.anything() })
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
