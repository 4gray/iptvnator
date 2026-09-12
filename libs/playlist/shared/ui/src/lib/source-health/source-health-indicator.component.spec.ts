import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { SourceHealthService } from '@iptvnator/portal/shared/data-access';
import { SourceHealthSnapshot } from '@iptvnator/shared/interfaces';
import { SourceHealthIndicatorComponent } from './source-health-indicator.component';

describe('SourceHealthIndicatorComponent', () => {
    it.each(['en', 'zhtw'])(
        'updates the dot and localized time without restarting its request (%s)',
        (language) => {
            const snapshot = signal<SourceHealthSnapshot | undefined>(
                undefined
            );
            const check = jest.fn().mockImplementation(() => {
                snapshot(); // The real coordinator reads its signal-backed cache.
                return Promise.resolve();
            });
            TestBed.configureTestingModule({
                imports: [
                    SourceHealthIndicatorComponent,
                    TranslateModule.forRoot(),
                    NoopAnimationsModule,
                ],
                providers: [
                    {
                        provide: RuntimeCapabilitiesService,
                        useValue: { supportsSourceHealth: true },
                    },
                    {
                        provide: SourceHealthService,
                        useValue: { get: snapshot, check },
                    },
                ],
            });
            TestBed.inject(TranslateService).use(language);
            const fixture = TestBed.createComponent(
                SourceHealthIndicatorComponent
            );
            fixture.componentRef.setInput('playlist', {
                _id: 'a',
                url: 'https://source.test/list',
            });
            fixture.detectChanges();
            const requestSignal = check.mock.calls[0][1].signal as AbortSignal;
            snapshot.set({
                state: 'active',
                reason: 'available',
                confirmedInactive: false,
                checkedAt: Date.now(),
            });
            fixture.detectChanges();
            expect(fixture.componentInstance.description()).toContain(' · ');
            expect(check).toHaveBeenCalledTimes(1);
            expect(requestSignal.aborted).toBe(false);
            expect(
                fixture.nativeElement.querySelector('.health-dot').dataset.state
            ).toBe('active');
            fixture.destroy();
            expect(requestSignal.aborted).toBe(true);
        }
    );
});
