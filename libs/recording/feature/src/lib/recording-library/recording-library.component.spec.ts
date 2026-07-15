import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RecordingService } from '@iptvnator/recording/data-access';
import type { RecordingItem } from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RecordingLibraryComponent } from './recording-library.component';

function recording(
    id: string,
    status: RecordingItem['status'],
    start: string,
    fileAvailable = false
): RecordingItem {
    return {
        id,
        playlistId: 'playlist-1',
        sourceType: 'xtream',
        channelId: '42',
        channelName: 'News',
        title: id,
        scheduledStartAt: start,
        scheduledEndAt: start,
        paddingBeforeSeconds: 0,
        paddingAfterSeconds: 0,
        status,
        fileAvailable,
    };
}

describe('RecordingLibraryComponent', () => {
    let fixture: ComponentFixture<RecordingLibraryComponent>;
    let component: RecordingLibraryComponent;
    const initialRecordings = [
        recording('later', 'scheduled', '2026-07-14T20:00:00.000Z'),
        recording('earlier', 'scheduled', '2026-07-14T18:00:00.000Z'),
        recording('saved', 'completed', '2026-07-13T18:00:00.000Z', true),
        recording('failed', 'failed', '2026-07-12T18:00:00.000Z'),
    ];
    const recordings = signal<RecordingItem[]>(initialRecordings);
    const hasDesktopBridge = signal(true);
    const isAvailable = signal(true);
    const support = signal<{ supported: boolean; reason?: string }>({
        supported: true,
    });
    const loadError = signal<string | null>(null);
    const activeCount = signal(2);
    const refresh = jest.fn().mockResolvedValue(undefined);
    const cancel = jest.fn().mockResolvedValue({ success: true });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RecordingLibraryComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: RecordingService,
                    useValue: {
                        recordings,
                        activeCount,
                        hasDesktopBridge,
                        isAvailable,
                        support,
                        error: loadError,
                        isLoading: () => false,
                        hasLoaded: () => true,
                        refresh,
                        cancel,
                        remove: jest.fn().mockResolvedValue({ success: true }),
                        play: jest.fn().mockResolvedValue({ success: true }),
                        reveal: jest.fn().mockResolvedValue({ success: true }),
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(RecordingLibraryComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        hasDesktopBridge.set(true);
        isAvailable.set(true);
        support.set({ supported: true });
        recordings.set(initialRecordings);
        loadError.set(null);
        activeCount.set(2);
        refresh.mockClear();
        cancel.mockClear();
    });

    it('orders upcoming recordings by their next start time', () => {
        component.selectedFilter.set('upcoming');
        expect(component.visibleRecordings().map(({ id }) => id)).toEqual([
            'earlier',
            'later',
        ]);
    });

    it('shows only terminal entries backed by a local file in the library', () => {
        component.selectedFilter.set('library');
        expect(component.visibleRecordings().map(({ id }) => id)).toEqual([
            'saved',
        ]);
    });

    it('exposes and updates the selected recording filter', () => {
        fixture.detectChanges();
        const filters = Array.from<HTMLButtonElement>(
            fixture.nativeElement.querySelectorAll('.recordings-filter')
        );

        expect(filters).toHaveLength(3);
        expect(filters[0].getAttribute('aria-pressed')).toBe('true');
        expect(filters[1].getAttribute('aria-pressed')).toBe('false');

        filters[1].click();
        fixture.detectChanges();

        expect(filters[0].classList.contains('is-active')).toBe(false);
        expect(filters[0].getAttribute('aria-pressed')).toBe('false');
        expect(filters[1].classList.contains('is-active')).toBe(true);
        expect(filters[1].getAttribute('aria-pressed')).toBe('true');
    });

    it('maps every scheduler state to a status icon and translation key', () => {
        expect(component.statusIcon('recording')).toBe('fiber_manual_record');
        expect(component.statusIcon('interrupted')).toBe('power_settings_new');
        expect(component.statusLabel('missed')).toBe(
            'RECORDINGS.STATUS.MISSED'
        );
    });

    it('keeps the library available while showing a localized engine warning', () => {
        isAvailable.set(false);
        support.set({
            supported: false,
            reason: 'Native MPV recording is unavailable',
        });

        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'RECORDINGS.ENGINE_UNAVAILABLE_TITLE'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'RECORDINGS.ENGINE_UNAVAILABLE_BODY'
        );
        expect(fixture.nativeElement.textContent).not.toContain(
            'Native MPV recording is unavailable'
        );
        expect(
            fixture.nativeElement.querySelectorAll('.recordings-filter')
        ).toHaveLength(3);
    });

    it('renders RTL languages with the matching page direction', () => {
        recordings.set([]);
        TestBed.inject(TranslateService).use('ar');
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.recordings-page')
                .getAttribute('dir')
        ).toBe('rtl');
    });

    it('announces a language-neutral active count for one recording', () => {
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            RECORDINGS: { ACTIVE_COUNT_LABEL: 'Active recordings: {{count}}' },
        });
        translate.use('en');
        activeCount.set(1);
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.recordings-active-badge')
                .getAttribute('aria-label')
        ).toBe('Active recordings: 1');
    });

    it('shows a localized retry state after loading fails', () => {
        loadError.set('load');
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'RECORDINGS.LOAD_FAILED_TITLE'
        );
        fixture.nativeElement.querySelector('.recordings-empty button').click();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('prevents duplicate actions for the same recording', async () => {
        let finishCancel!: (result: { success: boolean }) => void;
        cancel.mockReturnValueOnce(
            new Promise((resolve) => {
                finishCancel = resolve;
            })
        );
        const item = recordings()[0];

        const first = component.cancel(item);
        const second = component.cancel(item);
        fixture.detectChanges();

        expect(cancel).toHaveBeenCalledTimes(1);
        expect(component.isActionPending(item.id)).toBe(true);
        finishCancel({ success: true });
        await Promise.all([first, second]);
        expect(component.isActionPending(item.id)).toBe(false);
    });
});
