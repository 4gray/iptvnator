import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { provideRouter, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
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
    const retryContentInitialization = jest.fn().mockResolvedValue(undefined);

    beforeEach(async () => {
        contentInitBlockReason.set(null);
        isContentInitialized.set(false);
        portalStatus.set('active');
        retryContentInitialization.mockClear();

        await TestBed.configureTestingModule({
            imports: [XtreamContentGateComponent],
            providers: [
                provideRouter([]),
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
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

    it('retries content initialization from the blocked state', () => {
        contentInitBlockReason.set('cancelled');
        fixture.detectChanges();

        const retryButton = fixture.nativeElement.querySelector(
            'button'
        ) as HTMLButtonElement | null;
        retryButton?.click();

        expect(retryContentInitialization).toHaveBeenCalledTimes(1);
    });
});
