import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import {
    PortalStatusType,
    XtreamContentInitBlockReason,
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { DataService } from '@iptvnator/services';
import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';

describe('Xtream cached catalog status strip', () => {
    let fixture: ComponentFixture<XtreamCachedOfflineNoticeComponent>;
    const portalStatus = signal<PortalStatusType>('unavailable');
    const initialized = signal(true);
    const blocked = signal<XtreamContentInitBlockReason | null>(null);
    const playlist = signal<XtreamPlaylistData | null>(null);
    const checkPortalStatus = jest.fn<Promise<PortalStatusType>, []>();
    const sendIpcEvent = jest.fn();

    beforeEach(async () => {
        portalStatus.set('unavailable');
        initialized.set(true);
        blocked.set(null);
        playlist.set({
            id: 'source-1',
            name: 'Test portal',
            type: 'xtream',
            serverUrl: 'http://portal.example.test',
            username: 'user',
            password: 'password',
        });
        checkPortalStatus.mockReset().mockResolvedValue('unavailable');
        sendIpcEvent.mockReset().mockResolvedValue(undefined);
        await TestBed.configureTestingModule({
            imports: [XtreamCachedOfflineNoticeComponent],
            providers: [
                provideTranslateService(),
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: XtreamStore,
                    useValue: {
                        portalStatus,
                        isContentInitialized: initialized,
                        contentInitBlockReason: blocked,
                        currentPlaylist: playlist,
                        checkPortalStatus,
                    },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(XtreamCachedOfflineNoticeComponent);
        fixture.detectChanges();
    });

    const strip = () =>
        fixture.nativeElement.querySelector(
            '[role="status"]'
        ) as HTMLElement | null;

    it.each([
        ['unavailable', 'PORTAL_UNAVAILABLE', 'cloud_off', false],
        ['expired', 'ACCOUNT_EXPIRED', 'event_busy', true],
        ['inactive', 'ACCOUNT_INACTIVE', 'block', true],
    ] as const)(
        'explains cached %s accounts with the matching tone and icon',
        (status, key, icon, error) => {
            portalStatus.set(status);
            fixture.detectChanges();
            expect(strip()?.dataset['status']).toBe(status);
            expect(strip()?.textContent).toContain(
                `PORTALS.ERROR_VIEW.${key}.TITLE`
            );
            expect(strip()?.textContent).toContain(
                'PORTALS.STATUS_NOTICE.CACHED_DESCRIPTION'
            );
            expect(
                strip()?.querySelector('mat-icon')?.textContent?.trim()
            ).toBe(icon);
            expect(
                strip()?.classList.contains(
                    'xtream-cached-offline-notice--error'
                )
            ).toBe(error);
        }
    );

    it('does not add a banner for a healthy portal or replace a blocked/no-cache screen', () => {
        portalStatus.set('active');
        fixture.detectChanges();
        expect(strip()).toBeNull();
        portalStatus.set('expired');
        initialized.set(false);
        fixture.detectChanges();
        expect(strip()).toBeNull();
        initialized.set(true);
        blocked.set('expired');
        fixture.detectChanges();
        expect(strip()).toBeNull();
    });

    it('resets the host guard before checking without importing or clearing the catalog', async () => {
        await fixture.componentInstance.checkAgain();
        expect(sendIpcEvent).toHaveBeenCalledWith(CONNECTIVITY_GUARD_RESET, {
            url: 'http://portal.example.test',
        });
        expect(sendIpcEvent.mock.invocationCallOrder[0]).toBeLessThan(
            checkPortalStatus.mock.invocationCallOrder[0]
        );
        expect(checkPortalStatus).toHaveBeenCalledTimes(1);
        expect(initialized()).toBe(true);
    });

    it('announces checking, prevents duplicate requests and removes the strip on recovery', async () => {
        let finish!: (value: PortalStatusType) => void;
        checkPortalStatus.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const check = fixture.componentInstance.checkAgain();
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
        expect(strip()?.dataset['status']).toBe('checking');
        expect(strip()?.getAttribute('aria-busy')).toBe('true');
        expect(strip()?.textContent).toContain(
            'PORTALS.STATUS_NOTICE.CHECKING'
        );
        expect(
            strip()?.classList.contains(
                'xtream-cached-offline-notice--checking'
            )
        ).toBe(true);
        expect(strip()?.querySelector('button')?.disabled).toBe(true);
        await fixture.componentInstance.checkAgain();
        expect(checkPortalStatus).toHaveBeenCalledTimes(1);
        portalStatus.set('active');
        finish('active');
        await check;
        fixture.detectChanges();
        expect(strip()).toBeNull();
        expect(fixture.componentInstance.isChecking()).toBe(false);
    });

    it('allows another attempt after failure', async () => {
        checkPortalStatus.mockRejectedValueOnce(
            new Error('Unexpected probe failure')
        );
        await expect(fixture.componentInstance.checkAgain()).rejects.toThrow(
            'Unexpected probe failure'
        );
        expect(fixture.componentInstance.isChecking()).toBe(false);
        await fixture.componentInstance.checkAgain();
        expect(checkPortalStatus).toHaveBeenCalledTimes(2);
    });

    it('does not check a different source selected while the guard reset is pending', async () => {
        let finish!: () => void;
        sendIpcEvent.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
        );
        const check = fixture.componentInstance.checkAgain();
        const previous = playlist();
        if (!previous) throw new Error('Missing test playlist');
        playlist.set({ ...previous, id: 'source-2' });
        finish();
        await check;
        expect(checkPortalStatus).not.toHaveBeenCalled();
        expect(fixture.componentInstance.isChecking()).toBe(false);
    });
});
