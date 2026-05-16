import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { provideRouter, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    PlaylistContextFacade,
    SourceVpnPreparationService,
} from '@iptvnator/playlist/shared/util';
import {
    XtreamContentInitBlockReason,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { XtreamCachedOfflineNoticeComponent } from './xtream-cached-offline-notice.component';
import { XtreamContentGateComponent } from './xtream-content-gate.component';

@Component({
    selector: 'app-playlist-error-view',
    standalone: true,
    template: `
        <div class="mock-error">
            <span class="mock-error__title">{{ title() }}</span>
            <span class="mock-error__description">{{ description() }}</span>
        </div>
    `,
})
class MockPlaylistErrorViewComponent {
    readonly title = input<string>('');
    readonly description = input<string | undefined>(undefined);
}

describe('XtreamContentGateComponent', () => {
    let fixture: ComponentFixture<XtreamContentGateComponent>;
    const contentInitBlockReason =
        signal<XtreamContentInitBlockReason | null>(null);
    const isContentInitialized = signal(false);
    const portalStatus = signal<'active' | 'inactive' | 'expired' | 'unavailable'>(
        'active'
    );
    const routeProvider = signal<'xtreams' | null>('xtreams');
    const activePlaylist = signal({
        _id: 'source-1',
        title: 'Source 1',
        count: 0,
        importDate: '',
        autoRefresh: false,
        vpnAutoConnectOnOpen: true,
        vpnLocation: 'HR',
        vpnProvider: 'proton',
    });
    const retryContentInitialization = jest.fn().mockResolvedValue(undefined);
    const prepareForPlaylist = jest.fn().mockResolvedValue(null);

    beforeEach(async () => {
        contentInitBlockReason.set(null);
        isContentInitialized.set(false);
        portalStatus.set('active');
        routeProvider.set('xtreams');
        retryContentInitialization.mockClear();
        prepareForPlaylist.mockClear();

        await TestBed.configureTestingModule({
            imports: [XtreamContentGateComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        getParsedResult: (...args: unknown[]) =>
                            args.find(
                                (value): value is string =>
                                    typeof value === 'string'
                            ) ?? '',
                        stream: (key: string) => of(key),
                        onLangChange: of({
                            lang: 'en',
                            translations: {},
                        }),
                        onTranslationChange: of({
                            lang: 'en',
                            translations: {},
                        }),
                        onDefaultLangChange: of({
                            lang: 'en',
                            translations: {},
                        }),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        contentInitBlockReason,
                        isContentInitialized,
                        portalStatus,
                        retryContentInitialization,
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        activePlaylist,
                        routeProvider,
                    },
                },
                {
                    provide: SourceVpnPreparationService,
                    useValue: {
                        prepareForPlaylist,
                    },
                },
            ],
        })
            .overrideComponent(XtreamContentGateComponent, {
                set: {
                    imports: [
                        MatButtonModule,
                        MatIconModule,
                        MockPlaylistErrorViewComponent,
                        RouterOutlet,
                        TranslatePipe,
                        XtreamCachedOfflineNoticeComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(XtreamContentGateComponent);
    });

    it.each([
        ['cancelled', 'PORTALS.ERROR_VIEW.IMPORT_CANCELLED.TITLE'],
        ['expired', 'PORTALS.ERROR_VIEW.ACCOUNT_EXPIRED.TITLE'],
        ['inactive', 'PORTALS.ERROR_VIEW.ACCOUNT_INACTIVE.TITLE'],
        ['unavailable', 'PORTALS.ERROR_VIEW.PORTAL_UNAVAILABLE.TITLE'],
        ['error', 'PORTALS.ERROR_VIEW.UNKNOWN_ERROR.TITLE'],
    ] as const)(
        'renders the blocked error state for %s imports',
        (reason, expectedTitleKey) => {
            contentInitBlockReason.set(reason);
            fixture.detectChanges();

            const title = fixture.nativeElement.querySelector(
                '.mock-error__title'
            ) as HTMLElement | null;
            expect(title?.textContent?.trim()).toBe(expectedTitleKey);
        }
    );

    it('keeps the child outlet available when there is no block reason', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.mock-error')
        ).toBeNull();
        expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    });

    it('shows an inline warning when cached content remains available offline', () => {
        isContentInitialized.set(true);
        portalStatus.set('unavailable');
        fixture.detectChanges();

        const warning = fixture.nativeElement.querySelector(
            '[data-testid="xtream-offline-warning"]'
        ) as HTMLElement | null;

        expect(warning?.textContent).toContain(
            'PORTALS.ERROR_VIEW.PORTAL_UNAVAILABLE.TITLE'
        );
        expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    });

    it('prepares the source VPN before retrying content initialization from the blocked state', async () => {
        contentInitBlockReason.set('cancelled');
        fixture.detectChanges();

        const retryButton = fixture.nativeElement.querySelector(
            'button'
        ) as HTMLButtonElement | null;
        retryButton?.click();
        await fixture.whenStable();
        await Promise.resolve();

        expect(prepareForPlaylist).toHaveBeenCalledWith(
            activePlaylist(),
            'source-open'
        );
        expect(retryContentInitialization).toHaveBeenCalledTimes(1);
    });
});
