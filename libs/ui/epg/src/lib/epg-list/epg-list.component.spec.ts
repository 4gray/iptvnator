import { registerLocaleData } from '@angular/common';
import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import localeDe from '@angular/common/locales/de';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject, of } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';
import { EpgListComponent } from './epg-list.component';

let requestAnimationFrameQueue: FrameRequestCallback[] = [];

registerLocaleData(localeDe, 'de');

@Component({
    selector: 'app-epg-list-item',
    standalone: true,
    template: '',
})
class StubEpgListItemComponent {
    readonly item = input<EpgProgram>();
    readonly isLive = input(false);
    readonly isActive = input(false);
    readonly showArchiveBadge = input(false);
}

describe('EpgListComponent', () => {
    let fixture: ComponentFixture<EpgListComponent>;
    let component: EpgListComponent;
    let store: { select: jest.Mock; dispatch: jest.Mock };
    let epgService: { currentEpgPrograms$: BehaviorSubject<EpgProgram[]> };
    let translateService: {
        currentLang: string;
        defaultLang: string;
        onLangChange: BehaviorSubject<unknown>;
    };
    let originalRequestAnimationFrame: typeof window.requestAnimationFrame;

    const fixedNow = new Date('2026-04-05T12:00:00.000Z');
    const controlledChannel: Channel = {
        id: 'channel-101',
        name: 'Channel 101',
        url: 'https://example.com/live.m3u8',
        group: { title: 'News' },
        tvg: {
            id: 'channel-101',
            name: 'Channel 101',
            url: '',
            logo: 'channel-101.png',
            rec: '3',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
        epgParams: '',
    };

    beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(fixedNow);

        originalRequestAnimationFrame = window.requestAnimationFrame;
        requestAnimationFrameQueue = [];
        window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
            requestAnimationFrameQueue.push(callback);
            return requestAnimationFrameQueue.length;
        }) as typeof window.requestAnimationFrame;

        store = {
            select: jest.fn().mockReturnValue(of(null)),
            dispatch: jest.fn(),
        };
        epgService = {
            currentEpgPrograms$: new BehaviorSubject<EpgProgram[]>([]),
        };
        translateService = {
            currentLang: 'en',
            defaultLang: 'en',
            onLangChange: new BehaviorSubject<unknown>(null),
        };

        await TestBed.configureTestingModule({
            imports: [EpgListComponent, NoopAnimationsModule],
            providers: [
                { provide: Store, useValue: store },
                { provide: EpgService, useValue: epgService },
                { provide: TranslateService, useValue: translateService },
            ],
        })
            .overrideComponent(EpgListComponent, {
                remove: {
                    imports: [EpgListItemComponent, TranslatePipe],
                },
                add: {
                    imports: [
                        StubEpgListItemComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(EpgListComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controlledChannel', controlledChannel);
        fixture.componentRef.setInput('controlledArchiveDays', 3);
    });

    afterEach(() => {
        fixture.destroy();
        window.requestAnimationFrame = originalRequestAnimationFrame;
        jest.useRealTimers();
    });

    it('auto-scrolls once on the initial current-day load', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());

        fixture.detectChanges();
        const scrollToSpy = configureScrollableProgramList(fixture);

        flushAnimationFrames();

        expect(scrollToSpy).toHaveBeenCalledTimes(1);
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 172 });
    });

    it('does not re-trigger auto-scroll on timer-driven updates', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());

        fixture.detectChanges();
        const scrollToSpy = configureScrollableProgramList(fixture);
        flushAnimationFrames();

        scrollToSpy.mockClear();
        jest.advanceTimersByTime(30_000);
        fixture.detectChanges();
        flushAnimationFrames();

        expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('keeps older same-day rows reachable after the initial scroll', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());

        fixture.detectChanges();
        const scrollToSpy = configureScrollableProgramList(fixture);
        const programList = fixture.nativeElement.querySelector(
            '#program-list'
        ) as HTMLElement;
        flushAnimationFrames();

        scrollToSpy.mockClear();
        programList.scrollTop = 0;
        jest.advanceTimersByTime(30_000);
        fixture.detectChanges();
        flushAnimationFrames();

        expect(programList.scrollTop).toBe(0);
        expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('does not re-arm auto-scroll when changing dates for the same selection', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());

        fixture.detectChanges();
        const scrollToSpy = configureScrollableProgramList(fixture);
        flushAnimationFrames();

        scrollToSpy.mockClear();
        component.changeDate('prev');
        fixture.detectChanges();
        component.changeDate('next');
        fixture.detectChanges();
        flushAnimationFrames();

        expect(scrollToSpy).not.toHaveBeenCalled();
    });

    it('re-arms auto-scroll when the effective selection changes', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());

        fixture.detectChanges();
        let scrollToSpy = configureScrollableProgramList(fixture);
        flushAnimationFrames();
        scrollToSpy.mockClear();

        fixture.componentRef.setInput(
            'controlledPrograms',
            buildPrograms({
                currentStart: '2026-04-05T11:45:00.000Z',
                currentStop: '2026-04-05T12:45:00.000Z',
                futureStart: '2026-04-05T12:45:00.000Z',
                futureStop: '2026-04-05T13:45:00.000Z',
            })
        );
        fixture.detectChanges();
        scrollToSpy = configureScrollableProgramList(fixture);
        flushAnimationFrames();

        expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });

    it('shows archived rows as clickable only when archive playback is supported', () => {
        const programs = buildPrograms();
        fixture.componentRef.setInput('controlledPrograms', programs);
        fixture.componentRef.setInput('archivePlaybackAvailable', false);

        fixture.detectChanges();

        expect(component.canActivateProgram(programs[0])).toBe(false);
        expect(component.canActivateProgram(programs[1])).toBe(true);
        expect(
            fixture.nativeElement.querySelectorAll('.program-item.clickable')
                .length
        ).toBe(1);

        fixture.componentRef.setInput('archivePlaybackAvailable', true);
        fixture.detectChanges();

        expect(component.canActivateProgram(programs[0])).toBe(true);
        expect(
            fixture.nativeElement.querySelectorAll('.program-item.clickable')
                .length
        ).toBe(2);
    });

    it('highlights an externally active archived program without marking the live program active', () => {
        const programs = buildPrograms();
        fixture.componentRef.setInput('controlledPrograms', programs);
        fixture.componentRef.setInput('archivePlaybackAvailable', true);
        fixture.componentRef.setInput('activeProgram', programs[0]);

        fixture.detectChanges();

        const rows = fixture.nativeElement.querySelectorAll('.program-item');

        expect(rows[0].classList).toContain('active');
        expect(rows[1].classList).toContain('current-program');
        expect(rows[1].classList).not.toContain('active');
    });

    it('exposes playable rows as keyboard-activatable buttons', () => {
        const programs = buildPrograms();
        const emitted: unknown[] = [];
        component.programActivated.subscribe((event) => emitted.push(event));
        fixture.componentRef.setInput('controlledPrograms', programs);
        fixture.componentRef.setInput('archivePlaybackAvailable', true);

        fixture.detectChanges();

        const archivedRow = fixture.nativeElement.querySelector(
            '.program-item.clickable'
        ) as HTMLElement;
        archivedRow.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        );

        expect(archivedRow.getAttribute('role')).toBe('button');
        expect(archivedRow.getAttribute('tabindex')).toBe('0');
        expect(emitted).toEqual([{ program: programs[0], type: 'timeshift' }]);
    });

    it('renders duplicate-start programs without duplicate track-key errors and keeps clicks bound to each row', () => {
        const programs = [
            buildProgram(
                'duplicate-a',
                'Duplicate Start A',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T09:30:00.000Z'
            ),
            buildProgram(
                'duplicate-b',
                'Duplicate Start B',
                '2026-04-05T09:00:00.000Z',
                '2026-04-05T10:00:00.000Z'
            ),
            buildProgram(
                'current',
                'Current Show',
                '2026-04-05T11:30:00.000Z',
                '2026-04-05T12:30:00.000Z'
            ),
        ];
        const emitted: unknown[] = [];
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        component.programActivated.subscribe((event) => emitted.push(event));
        fixture.componentRef.setInput('controlledPrograms', programs);
        fixture.componentRef.setInput('archivePlaybackAvailable', true);

        try {
            expect(component.trackProgram(0, programs[0])).not.toBe(
                component.trackProgram(1, programs[1])
            );

            fixture.detectChanges();

            const duplicateTrackKeyError = consoleErrorSpy.mock.calls.some(
                (args) => args.some((arg) => String(arg).includes('NG0955'))
            );
            const rows =
                fixture.nativeElement.querySelectorAll<HTMLElement>(
                    '.program-item.clickable'
                );
            rows[1].click();

            expect(duplicateTrackKeyError).toBe(false);
            expect(rows).toHaveLength(3);
            expect(emitted).toEqual([
                { program: programs[1], type: 'timeshift' },
            ]);
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });

    it('shows one row per duplicated time slot and keeps the richer program entry', () => {
        const sparseProgram = buildProgram(
            'duplicate-a',
            'World Cup Breakfast',
            '2026-04-05T09:00:00.000Z',
            '2026-04-05T10:00:00.000Z',
            {
                channel: 'channel-101',
                desc: null,
            }
        );
        const richProgram = buildProgram(
            'duplicate-b',
            'World Cup Breakfast',
            '2026-04-05T09:00:00.000Z',
            '2026-04-05T10:00:00.000Z',
            {
                channel: 'channel-101',
                desc: 'A preview of the day ahead.',
                category: 'Sports',
            }
        );
        const nextProgram = buildProgram(
            'next',
            'World Cup Matchday',
            '2026-04-05T10:00:00.000Z',
            '2026-04-05T11:00:00.000Z',
            {
                channel: 'channel-101',
            }
        );
        const emitted: unknown[] = [];
        component.programActivated.subscribe((event) => emitted.push(event));
        fixture.componentRef.setInput('controlledPrograms', [
            sparseProgram,
            richProgram,
            nextProgram,
        ]);
        fixture.componentRef.setInput('archivePlaybackAvailable', true);

        fixture.detectChanges();

        const rows =
            fixture.nativeElement.querySelectorAll<HTMLElement>(
                '.program-item'
            );
        rows[0].click();

        expect(component.filteredItems()).toEqual([
            richProgram,
            nextProgram,
        ]);
        expect(rows).toHaveLength(2);
        expect(emitted).toEqual([{ program: richProgram, type: 'timeshift' }]);
    });

    it('updates the selected-day header when the app language changes', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());
        fixture.detectChanges();

        translateService.currentLang = 'de';
        translateService.onLangChange.next({ lang: 'de' });
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.selected-date')
                .textContent.trim()
        ).toContain('Sonntag');
    });

    it('can hide its internal date navigator for a parent-owned toolbar', () => {
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());
        fixture.componentRef.setInput('showDateNavigator', false);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('#channel-header')
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector('#program-list')
        ).not.toBeNull();
    });

    it('emits date changes when the selected date is controlled', () => {
        const emittedDates: string[] = [];
        component.selectedDateChange.subscribe((date) =>
            emittedDates.push(date)
        );
        fixture.componentRef.setInput('selectedDate', '2026-04-04');
        fixture.componentRef.setInput('controlledPrograms', buildPrograms());
        fixture.detectChanges();

        component.changeDate('next');

        expect(emittedDates).toEqual(['2026-04-05']);
        expect(component.selectedDateKey()).toBe('2026-04-04');
    });
});

function buildPrograms(overrides?: {
    currentStart?: string;
    currentStop?: string;
    futureStart?: string;
    futureStop?: string;
}): EpgProgram[] {
    const pastStart = '2026-04-05T09:00:00.000Z';
    const pastStop = '2026-04-05T10:00:00.000Z';
    const currentStart = overrides?.currentStart ?? '2026-04-05T11:30:00.000Z';
    const currentStop = overrides?.currentStop ?? '2026-04-05T12:30:00.000Z';
    const futureStart = overrides?.futureStart ?? '2026-04-05T12:30:00.000Z';
    const futureStop = overrides?.futureStop ?? '2026-04-05T13:30:00.000Z';

    return [
        buildProgram('past', 'Past Show', pastStart, pastStop),
        buildProgram('current', 'Current Show', currentStart, currentStop),
        buildProgram('future', 'Future Show', futureStart, futureStop),
    ];
}

function buildProgram(
    channelSuffix: string,
    title: string,
    start: string,
    stop: string,
    overrides: Partial<EpgProgram> = {}
): EpgProgram {
    return {
        start,
        stop,
        channel: `channel-${channelSuffix}`,
        title,
        desc: null,
        category: null,
        startTimestamp: Math.floor(Date.parse(start) / 1000),
        stopTimestamp: Math.floor(Date.parse(stop) / 1000),
        ...overrides,
    };
}

function configureScrollableProgramList(
    fixture: ComponentFixture<EpgListComponent>
): jest.Mock {
    const programList = fixture.nativeElement.querySelector(
        '#program-list'
    ) as HTMLElement;
    const currentProgram = fixture.nativeElement.querySelector(
        '.program-item.current-program'
    ) as HTMLElement;

    let scrollTop = 0;
    Object.defineProperty(programList, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = value;
        },
    });
    Object.defineProperty(programList, 'clientHeight', {
        configurable: true,
        value: 120,
    });
    Object.defineProperty(currentProgram, 'offsetTop', {
        configurable: true,
        value: 240,
    });
    Object.defineProperty(currentProgram, 'offsetHeight', {
        configurable: true,
        value: 36,
    });

    const scrollToSpy = jest.fn(({ top }: { top: number }) => {
        scrollTop = top;
    });
    programList.scrollTo = scrollToSpy as typeof programList.scrollTo;

    return scrollToSpy;
}

function flushAnimationFrames(): void {
    while (requestAnimationFrameQueue.length > 0) {
        const callback = requestAnimationFrameQueue.shift();
        callback?.(0);
    }
}
