import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { ElectronBridgeAppUpdateStatus } from '@iptvnator/shared/interfaces';
import { AppStartupRecoveryComponent } from './app-startup-recovery.component';
import { AppMaintenanceService } from './services/app-maintenance.service';

describe('startup recovery build identity', () => {
    afterEach(() => {
        delete (window as { electron?: unknown }).electron;
    });

    it.each([
        ['stable', 'nightly', 'Stable'],
        ['nightly', 'stable', 'Nightly'],
    ] as const)(
        'labels the installed %s build while checking %s updates',
        async (installedChannel, channel, expected) => {
            const status: ElectronBridgeAppUpdateStatus = {
                currentVersion: '0.25.0',
                installedChannel,
                channel,
                status: 'idle',
                supportedSelfUpdate: true,
                manualDownloadUrl: 'https://example.invalid/releases',
            };
            (window as { electron?: unknown }).electron = {
                getAppUpdateStatus: () => Promise.resolve(status),
            };
            await TestBed.configureTestingModule({
                imports: [
                    AppStartupRecoveryComponent,
                    TranslateModule.forRoot(),
                ],
                providers: [
                    provideMockStore(),
                    {
                        provide: AppMaintenanceService,
                        useValue: { canCheckForUpdates: false },
                    },
                ],
            }).compileComponents();
            const translate = TestBed.inject(TranslateService);
            translate.setTranslation('en', {
                SETTINGS: {
                    APP_UPDATE_CHANNEL_NIGHTLY: 'Nightly',
                    APP_UPDATE_CHANNEL_STABLE: 'Stable',
                },
            });
            translate.use('en');
            const fixture = TestBed.createComponent(
                AppStartupRecoveryComponent
            );
            fixture.detectChanges();
            await fixture.whenStable();
            fixture.detectChanges();
            const identity = fixture.nativeElement.querySelector(
                '[data-test-id="startup-version"]'
            ) as HTMLElement;
            expect(identity.textContent?.replace(/\s+/g, ' ').trim()).toBe(
                `IPTVnator 0.25.0 · ${expected}`
            );
        }
    );
});
