import { DatePipe } from '@angular/common';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { ChannelListItemComponent } from './channel-list-item.component';

describe('ChannelListItemComponent', () => {
    let fixture: ComponentFixture<ChannelListItemComponent>;
    let dialog: { open: jest.Mock };

    beforeEach(async () => {
        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                ChannelListItemComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ChannelListItemComponent);
    });

    it('formats preview times from timestamp fields when raw strings are offset', () => {
        const startTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const stopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const program: EpgProgram = {
            start: '2026-04-05 03:00:00',
            stop: '2026-04-05 03:30:00',
            channel: 'channel-1',
            title: 'Current Show',
            desc: 'Current description',
            category: null,
            startTimestamp,
            stopTimestamp,
        };

        fixture.componentRef.setInput('name', 'Cartoon Network');
        fixture.componentRef.setInput('epgProgram', program);
        fixture.componentRef.setInput('showProgramInfoButton', false);
        fixture.detectChanges();

        const times = Array.from(
            fixture.nativeElement.querySelectorAll('.epg-time'),
            (element: Element) => element.textContent?.trim() ?? ''
        );
        const datePipe = new DatePipe('en-US');

        expect(times).toEqual([
            datePipe.transform(startTimestamp * 1000, 'HH:mm') ?? '',
            datePipe.transform(stopTimestamp * 1000, 'HH:mm') ?? '',
        ]);
    });

    it('hides the no-program placeholder for radio items without EPG data', () => {
        fixture.componentRef.setInput('name', 'Radio One');
        fixture.componentRef.setInput('showEpg', true);
        fixture.componentRef.setInput('isRadio', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.epg-placeholder')
        ).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.channel-list-item')
                .classList.contains('compact')
        ).toBe(false);
    });

    it('uses compact density when a radio consumer disables EPG', () => {
        fixture.componentRef.setInput('name', 'Radio One');
        fixture.componentRef.setInput('showEpg', false);
        fixture.componentRef.setInput('isRadio', true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.channel-list-item')
                .classList.contains('compact')
        ).toBe(true);
    });

    it('stacks the favorite button above the reserved programme-info slot', () => {
        const program: EpgProgram = {
            start: '2026-04-05 05:30:00',
            stop: '2026-04-05 06:00:00',
            channel: 'channel-1',
            title: 'Current Show',
            desc: 'Current description',
            category: null,
        };
        fixture.componentRef.setInput('name', 'Ordered Channel');
        fixture.componentRef.setInput('showFavoriteButton', true);
        fixture.componentRef.setInput('epgProgram', program);
        fixture.detectChanges();

        const buttons = Array.from(
            fixture.nativeElement.querySelectorAll('.action-buttons button'),
            (element: Element) => element.className
        );
        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toContain('favorite-button');
        expect(buttons[1]).toContain('program-info-button');
        expect(buttons[1]).not.toContain('slot-empty');
    });

    it('keeps an inert info slot while the row has no programme', () => {
        fixture.componentRef.setInput('name', 'No EPG Yet');
        fixture.componentRef.setInput('showFavoriteButton', true);
        fixture.detectChanges();

        // The slot must exist (reserving the geometry) but be inert, so the
        // star above it never shifts when EPG data arrives later.
        const slot = fixture.nativeElement.querySelector(
            '.program-info-button'
        );
        expect(slot).not.toBeNull();
        expect(slot.classList.contains('slot-empty')).toBe(true);
        expect(slot.disabled).toBe(true);

        slot.click();
        expect(dialog.open).not.toHaveBeenCalled();
    });

    it('renders the catch-up badge only when catch-up is available', () => {
        fixture.componentRef.setInput('name', 'Archive Channel');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="catchup-badge"]'
            )
        ).toBeNull();

        fixture.componentRef.setInput('catchupAvailable', true);
        fixture.componentRef.setInput('catchupDays', 7);
        fixture.detectChanges();

        const badge = fixture.nativeElement.querySelector(
            '[data-test-id="catchup-badge"]'
        );
        expect(badge).not.toBeNull();
        expect(badge.textContent).toContain('history');

        // The icon is aria-hidden — the status must also exist as
        // visually-hidden text for assistive technology.
        const srText = fixture.nativeElement.querySelector(
            '.channel-name-row .visually-hidden'
        );
        expect(srText?.textContent).toContain('CATCHUP_AVAILABLE');
    });

    it('shows the generic fallback icon when no logo is available', () => {
        fixture.componentRef.setInput('name', 'Channel Without Logo');
        fixture.componentRef.setInput('logo', '');
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.channel-logo-fallback')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.channel-logo')).toBeNull();
    });

    it('emits clicked on a single click by default', () => {
        const clicked = jest.fn();
        fixture.componentInstance.clicked.subscribe(clicked);

        fixture.componentInstance.onClick({ detail: 1 } as MouseEvent);

        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('suppresses the second browser click and emits activation on double click', () => {
        const clicked = jest.fn();
        const activated = jest.fn();
        fixture.componentInstance.clicked.subscribe(clicked);
        fixture.componentInstance.activated.subscribe(activated);

        fixture.componentInstance.onClick({ detail: 1 } as MouseEvent);
        fixture.componentInstance.onClick({ detail: 2 } as MouseEvent);
        fixture.componentInstance.onDoubleClick();

        expect(clicked).toHaveBeenCalledTimes(1);
        expect(activated).toHaveBeenCalledTimes(1);
    });

    it('emits a context menu request on right click when details are enabled', () => {
        fixture.componentRef.setInput('name', 'News One');
        fixture.componentRef.setInput('showDetailsContextMenu', true);
        fixture.detectChanges();

        const preventDefault = jest.fn();
        const stopPropagation = jest.fn();
        const contextMenuRequested = jest.fn();

        fixture.componentInstance.contextMenuRequested.subscribe(
            contextMenuRequested
        );

        fixture.componentInstance.onContextMenu({
            clientX: 120,
            clientY: 56,
            preventDefault,
            stopPropagation,
        } as unknown as MouseEvent);

        expect(preventDefault).toHaveBeenCalled();
        expect(stopPropagation).toHaveBeenCalled();
        expect(contextMenuRequested).toHaveBeenCalledWith(
            expect.objectContaining({
                clientX: 120,
                clientY: 56,
            })
        );
    });

    it('renders the raw channel name while prefix stripping is disabled', () => {
        fixture.componentRef.setInput('name', 'US | CNN');
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.channel-name')
                .textContent.trim()
        ).toBe('US | CNN');
    });

    describe('with strip country prefix enabled', () => {
        beforeEach(async () => {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                imports: [
                    ChannelListItemComponent,
                    NoopAnimationsModule,
                    TranslateModule.forRoot(),
                ],
                providers: [
                    { provide: MatDialog, useValue: dialog },
                    {
                        provide: SettingsStore,
                        useValue: {
                            stripCountryPrefix: signal(true),
                            resolvedEpgOffsetMinutes: signal(0),
                        },
                    },
                ],
            }).compileComponents();

            fixture = TestBed.createComponent(ChannelListItemComponent);
        });

        it('strips the country prefix from the rendered channel name', () => {
            fixture.componentRef.setInput('name', 'US | CNN');
            fixture.detectChanges();

            expect(
                fixture.nativeElement
                    .querySelector('.channel-name')
                    .textContent.trim()
            ).toBe('CNN');
        });
    });
});

describe('ChannelListItemComponent with an EPG display offset', () => {
    it('shifts the preview times by the offset without touching the programme', async () => {
        await TestBed.configureTestingModule({
            imports: [
                ChannelListItemComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: MatDialog, useValue: { open: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: {
                        stripCountryPrefix: signal(false),
                        resolvedEpgOffsetMinutes: signal(90),
                    },
                },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(ChannelListItemComponent);
        const startTimestamp = Math.floor(
            Date.parse('2026-04-05T05:30:00.000Z') / 1000
        );
        const stopTimestamp = Math.floor(
            Date.parse('2026-04-05T06:00:00.000Z') / 1000
        );
        const program: EpgProgram = {
            start: '2026-04-05T05:30:00.000Z',
            stop: '2026-04-05T06:00:00.000Z',
            channel: 'channel-1',
            title: 'Current Show',
            desc: null,
            category: null,
            startTimestamp,
            stopTimestamp,
        };

        fixture.componentRef.setInput('name', 'Cartoon Network');
        fixture.componentRef.setInput('epgProgram', program);
        fixture.componentRef.setInput('showProgramInfoButton', false);
        fixture.detectChanges();

        const times = Array.from(
            fixture.nativeElement.querySelectorAll('.epg-time'),
            (element: Element) => element.textContent?.trim() ?? ''
        );
        const datePipe = new DatePipe('en-US');
        const shiftMs = 90 * 60_000;

        expect(times).toEqual([
            datePipe.transform(startTimestamp * 1000 + shiftMs, 'HH:mm') ?? '',
            datePipe.transform(stopTimestamp * 1000 + shiftMs, 'HH:mm') ?? '',
        ]);
        // The row still hands the raw programme to consumers (dialog, catch-up).
        expect(program.startTimestamp).toBe(startTimestamp);
    });
});
