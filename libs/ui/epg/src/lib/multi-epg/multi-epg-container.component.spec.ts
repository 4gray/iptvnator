import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OverlayRef } from '@angular/cdk/overlay';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
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

describe('MultiEpgContainerComponent runtime gates', () => {
    let fixture: ComponentFixture<MultiEpgContainerComponent>;
    let component: MultiEpgContainerComponent;
    let runtimeCapabilities: { supportsEpg: boolean };
    const originalElectron = window.electron;

    beforeEach(async () => {
        runtimeCapabilities = { supportsEpg: false };

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
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
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
        window.electron = originalElectron;
        fixture.destroy();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('does not request EPG channel ranges when runtime EPG support is disabled', async () => {
        const getEpgChannelsByRange = jest.fn().mockResolvedValue([]);
        window.electron = {
            ...window.electron,
            getEpgChannelsByRange,
        } as unknown as typeof window.electron;
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await component.requestPrograms();

        expect(getEpgChannelsByRange).not.toHaveBeenCalled();
        expect(component.isLoading()).toBe(false);
    });

    it('requests EPG channel ranges when runtime EPG support is enabled', async () => {
        const getEpgChannelsByRange = jest.fn().mockResolvedValue([
            {
                channel_id: 'channel-1',
                display_name: 'Channel One',
                programs: [],
            },
        ]);
        window.electron = {
            ...window.electron,
            getEpgChannelsByRange,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;

        await component.requestPrograms();

        expect(getEpgChannelsByRange).toHaveBeenCalledWith(0, 20);
        expect(component.isLoading()).toBe(false);
    });

    it('does not search EPG programs when runtime EPG support is disabled', () => {
        jest.useFakeTimers();
        const searchEpgPrograms = jest.fn().mockResolvedValue([]);
        window.electron = {
            ...window.electron,
            searchEpgPrograms,
        } as unknown as typeof window.electron;

        component.onProgramSearchInput({
            target: { value: 'news' },
        } as unknown as Event);
        jest.advanceTimersByTime(600);

        expect(searchEpgPrograms).not.toHaveBeenCalled();
        expect(component.isSearchingPrograms()).toBe(false);
        expect(component.programSearchResults()).toEqual([]);
    });

    it('searches EPG programs when runtime EPG support is enabled', async () => {
        jest.useFakeTimers();
        const results = [
            {
                channelId: 'channel-1',
                start: '2026-05-22T10:00:00.000Z',
                stop: '2026-05-22T11:00:00.000Z',
                title: 'News',
            },
        ];
        const searchEpgPrograms = jest.fn().mockResolvedValue(results);
        window.electron = {
            ...window.electron,
            searchEpgPrograms,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpg = true;

        component.onProgramSearchInput({
            target: { value: 'news' },
        } as unknown as Event);
        jest.advanceTimersByTime(500);
        await Promise.resolve();

        expect(searchEpgPrograms).toHaveBeenCalledWith('news', 20);
        expect(component.programSearchResults()).toEqual(results);
        expect(component.isSearchingPrograms()).toBe(false);
    });
});
