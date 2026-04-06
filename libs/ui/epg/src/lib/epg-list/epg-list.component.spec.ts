import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockPipe } from 'ng-mocks';
import { BehaviorSubject, of } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { MomentDatePipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';
import { EpgListComponent } from './epg-list.component';

let requestAnimationFrameQueue: FrameRequestCallback[] = [];

@Component({
    selector: 'app-epg-list-item',
    standalone: true,
    template: '',
})
class StubEpgListItemComponent {
    readonly item = input<EpgProgram>();
    readonly timeNow = input('');
    readonly timeshiftUntil = input('');
}

describe('EpgListComponent', () => {
    let fixture: ComponentFixture<EpgListComponent>;
    let component: EpgListComponent;
    let store: { select: jest.Mock; dispatch: jest.Mock };
    let epgService: { currentEpgPrograms$: BehaviorSubject<EpgProgram[]> };
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

        await TestBed.configureTestingModule({
            imports: [EpgListComponent, NoopAnimationsModule],
            providers: [
                { provide: Store, useValue: store },
                { provide: EpgService, useValue: epgService },
            ],
        })
            .overrideComponent(EpgListComponent, {
                remove: {
                    imports: [
                        EpgListItemComponent,
                        MomentDatePipe,
                        TranslatePipe,
                    ],
                },
                add: {
                    imports: [
                        StubEpgListItemComponent,
                        MockPipe(
                            MomentDatePipe,
                            (
                                value: string | null | undefined,
                                format?: string
                            ) => {
                                if (!value) {
                                    return '';
                                }

                                const parsed = new Date(value);
                                if (format === 'HH:mm') {
                                    return parsed
                                        .toISOString()
                                        .slice(11, 16);
                                }

                                return value.slice(0, 10);
                            }
                        ),
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
});

function buildPrograms(overrides?: {
    currentStart?: string;
    currentStop?: string;
    futureStart?: string;
    futureStop?: string;
}): EpgProgram[] {
    const pastStart = '2026-04-05T09:00:00.000Z';
    const pastStop = '2026-04-05T10:00:00.000Z';
    const currentStart =
        overrides?.currentStart ?? '2026-04-05T11:30:00.000Z';
    const currentStop = overrides?.currentStop ?? '2026-04-05T12:30:00.000Z';
    const futureStart =
        overrides?.futureStart ?? '2026-04-05T12:30:00.000Z';
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
    stop: string
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
