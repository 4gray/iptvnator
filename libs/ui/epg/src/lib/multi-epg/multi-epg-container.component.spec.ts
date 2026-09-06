import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverlayRef } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    MultiEpgContainerComponent,
    isSelectedEpgDayToday,
} from './multi-epg-container.component';
import { COMPONENT_OVERLAY_REF } from './overlay-ref.token';

describe('isSelectedEpgDayToday', () => {
    it('returns true only when the selected EPG day is the actual current day', () => {
        const now = new Date('2026-05-21T20:00:00.000Z');

        expect(isSelectedEpgDayToday('20260521', now)).toBe(true);
        expect(isSelectedEpgDayToday('20260520', now)).toBe(false);
        expect(isSelectedEpgDayToday('20260522', now)).toBe(false);
    });
});

function programAt(start: Date, minutes: number, title: string): EpgProgram {
    return {
        start: start.toISOString(),
        stop: new Date(start.getTime() + minutes * 60_000).toISOString(),
        channel: 'c1',
        title,
        desc: null,
        category: null,
    };
}

describe('MultiEpgContainerComponent runtime gates', () => {
    let fixture: ComponentFixture<MultiEpgContainerComponent>;
    let component: MultiEpgContainerComponent;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    const epgOffsetMinutes = signal(0);

    beforeEach(async () => {
        epgOffsetMinutes.set(0);
        epgBridge = {
            searchPrograms: jest.fn().mockResolvedValue([]),
            supportsGuide: false,
            supportsProgramSearch: false,
        };

        await TestBed.configureTestingModule({
            imports: [MultiEpgContainerComponent],
            providers: [
                { provide: MatDialog, useValue: { open: jest.fn() } },
                {
                    provide: COMPONENT_OVERLAY_REF,
                    useValue: { detach: jest.fn() },
                },
                {
                    provide: OverlayRef,
                    useValue: { detach: jest.fn() },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: epgOffsetMinutes },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        currentLang: 'en',
                        defaultLang: 'en',
                        onLangChange: of(null),
                    },
                },
            ],
        })
            .overrideComponent(MultiEpgContainerComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(MultiEpgContainerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('lays programmes out in display time when an EPG offset is set', () => {
        const morning = new Date();
        morning.setHours(10, 0, 0, 0);
        const late = new Date();
        late.setHours(23, 30, 0, 0);
        component.originalEpgData.set([
            {
                id: 'c1',
                displayName: 'Channel 1',
                programs: [
                    programAt(morning, 60, 'Morning'),
                    programAt(late, 60, 'Late'),
                ],
            } as unknown as ReturnType<
                typeof component.originalEpgData
            >[number],
        ]);

        epgOffsetMinutes.set(90);

        // 23:30 + 90 min lands on the next day and leaves today's column;
        // 10:00 + 90 min is drawn under 11:30.
        const programs = component.channels()[0].programs;
        expect(programs.map((program) => program.title)).toEqual(['Morning']);
        expect(programs[0].startPosition).toBe(11.5 * component.hourWidth());
        expect(programs[0].width).toBe(component.hourWidth());
    });

    it('does not request EPG channel ranges when the EPG bridge cannot browse channels', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await component.requestPrograms();

        expect(component.isLoading()).toBe(false);
    });

    // This legacy grid's `EPG_GET_CHANNELS_BY_RANGE` read was removed in
    // Task 2 (it never carried real data past this point regardless — see
    // the temporary `Promise.resolve([])` in `requestPrograms()`); the whole
    // component is deleted in Task 10.
    it.skip('requests EPG channel ranges through the EPG runtime bridge', async () => {
        epgBridge.supportsGuide = true;

        await component.requestPrograms();

        expect(component.isLoading()).toBe(false);
    });

    it('does not search EPG programs when the EPG bridge cannot search programs', () => {
        jest.useFakeTimers();

        component.onProgramSearchInput({
            target: { value: 'news' },
        } as unknown as Event);
        jest.advanceTimersByTime(600);

        expect(epgBridge.searchPrograms).not.toHaveBeenCalled();
        expect(component.isSearchingPrograms()).toBe(false);
        expect(component.programSearchResults()).toEqual([]);
    });

    it('searches EPG programs through the EPG runtime bridge', async () => {
        jest.useFakeTimers();
        const results = [
            {
                channelId: 'channel-1',
                start: '2026-05-22T10:00:00.000Z',
                stop: '2026-05-22T11:00:00.000Z',
                title: 'News',
            },
        ];
        epgBridge.searchPrograms = jest.fn().mockResolvedValue(results);
        epgBridge.supportsProgramSearch = true;

        component.onProgramSearchInput({
            target: { value: 'news' },
        } as unknown as Event);
        jest.advanceTimersByTime(500);
        await Promise.resolve();

        expect(epgBridge.searchPrograms).toHaveBeenCalledWith('news', 20);
        expect(component.programSearchResults()).toEqual(results);
        expect(component.isSearchingPrograms()).toBe(false);
    });
});
