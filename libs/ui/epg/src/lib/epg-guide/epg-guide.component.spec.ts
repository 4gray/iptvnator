import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, of } from 'rxjs';
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
    const activate = jest.fn();
    const setScope = jest.fn();
    const dialogOpen = jest.fn(() => of(undefined));

    beforeEach(() => {
        localStorage.clear();
        activate.mockReset();
        setScope.mockReset();
        dialogOpen.mockClear();
        channels.set([
            channel('a', 'a', 1),
            channel('b', null, 2),
            channel('c', 'c', 3),
        ]);
        activeChannelId.set('a');
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
            activate,
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
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: new BehaviorSubject(null),
                        onTranslationChange: new BehaviorSubject(null),
                        onDefaultLangChange: new BehaviorSubject(null),
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
        component.activateRow(component.rows()[2]);
        expect(activate).toHaveBeenCalledWith('c');
        expect(close).not.toHaveBeenCalled();
        component.commitRow(component.rows()[2]);
        expect(close).toHaveBeenCalledTimes(1);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(activate).toHaveBeenLastCalledWith('a');
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
        const row = component.rows()[0];
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
                channelName: 'Channel a',
                primaryAction: null,
                archiveUnavailableNote: true,
            })
        );
        expect(activate).toHaveBeenCalledWith('a');
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
});
