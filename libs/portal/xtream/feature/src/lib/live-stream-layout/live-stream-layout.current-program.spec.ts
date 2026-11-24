import { TestBed } from '@angular/core/testing';
import { LiveStreamLayoutComponent } from './live-stream-layout.component';
import { setupLiveStreamLayoutNativeFixture } from './live-stream-layout-native.test-fixture';
import { epgItem } from './live-stream-layout-stubs.spec-data';

/**
 * The programme on air moves on as time passes, without a new schedule.
 * Split from `live-stream-layout.component.spec.ts`, which sits at the spec
 * line cap.
 */
describe('LiveStreamLayoutComponent current programme', () => {
    const { epgItems, restoreElectron } = setupLiveStreamLayoutNativeFixture();
    const T0 = Date.parse('2026-04-04T10:00:00.000Z');

    beforeEach(() => {
        jest.useFakeTimers({ now: T0 + 59 * 60_000 });
    });

    afterEach(() => {
        jest.useRealTimers();
        restoreElectron();
    });

    it('moves the panel summary to the next show at its start', () => {
        epgItems.set([
            epgItem('Synthetic Morning', 0, 1),
            epgItem('Synthetic Noon', 1, 2),
        ]);
        const fixture = TestBed.createComponent(LiveStreamLayoutComponent);
        const component = fixture.componentInstance;
        fixture.detectChanges();
        expect(component.liveEpgPanelSummary()?.title).toBe(
            'Synthetic Morning'
        );

        // The schedule is unchanged; only the 30 s tick passes the boundary.
        jest.advanceTimersByTime(2 * 60_000);
        fixture.detectChanges();

        expect(component.currentEpgItem()?.title).toBe('Synthetic Noon');
        expect(component.liveEpgPanelSummary()?.title).toBe('Synthetic Noon');
        fixture.destroy();
    });
});
