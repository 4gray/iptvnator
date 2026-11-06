import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EpgPreferencesService } from '@iptvnator/services';
import { StalkerItvAllItemsComponent } from '../stalker-itv-all-items.component';
import { StalkerLiveStreamLayoutComponent } from '../stalker-live-stream-layout.component';

interface OverviewHarness {
    fixture(): ComponentFixture<StalkerLiveStreamLayoutComponent>;
    component(): StalkerLiveStreamLayoutComponent;
    enterOverview(): void;
    settle(): Promise<void>;
    ensureBulk(): jest.Mock;
    fetchShort(): jest.Mock;
    applyMapping: jest.Mock;
    mockFutureOnlyBulkEpg(): void;
    switchPlaylist(): void;
}

/** Shares the live-layout fixture without growing its legacy spec past the limit. */
export function registerStalkerLiveOverviewCases(
    harness: OverviewHarness
): void {
    const overview = (): StalkerItvAllItemsComponent =>
        harness
            .fixture()
            .debugElement.query(By.directive(StalkerItvAllItemsComponent))
            .componentInstance;

    it('shows all channels instead of the placeholder when the full list is available', () => {
        harness.enterOverview();
        harness.fixture().detectChanges();

        const grid = harness
            .fixture()
            .nativeElement.querySelector('app-stalker-itv-all-items');
        expect(grid).toBeTruthy();
        expect(grid.querySelectorAll('mat-card')).toHaveLength(2);
        expect(
            harness
                .fixture()
                .nativeElement.querySelector('app-portal-empty-state')
        ).toBeNull();
    });

    it('starts bulk EPG on the overview before any category has channels', async () => {
        harness.enterOverview();
        await harness.settle();

        expect(harness.ensureBulk()).toHaveBeenCalledWith(168);
        expect(overview().epgPrograms().get('10001')?.title).toBe(
            'Current Show'
        );
        expect(overview().epgProgress().get('10001')).toBeGreaterThan(0);
        expect(harness.applyMapping).toHaveBeenCalledWith(['10001', '10002']);
    });

    it('forwards explicit overview activation with playback enabled', () => {
        harness.enterOverview();
        harness.fixture().detectChanges();
        const play = jest
            .spyOn(harness.component(), 'playChannel')
            .mockResolvedValue(undefined);
        const channel = overview().channels()[0];
        overview().channelActivated.emit(channel);
        expect(play).toHaveBeenCalledWith(channel, true);
    });

    it('keeps the floating restore out of the overview header and restores through the child', async () => {
        harness.enterOverview();
        if (harness.component().isSidebarCollapsed()) {
            harness.component().livePanels.toggleSidebar();
        }
        await harness.settle();
        (document.activeElement as HTMLElement | null)?.blur();
        harness.component().livePanels.collapsePanels();
        harness.fixture().detectChanges();
        await harness.fixture().whenStable();

        expect(
            harness.fixture().nativeElement.querySelector('.sidebar-restore')
        ).toBeNull();
        expect(overview().sidebarCollapsed()).toBe(true);
        expect(document.activeElement).toBe(
            harness.fixture().nativeElement.querySelector('.overview-restore')
        );
        overview().restorePanels.emit();
        harness.fixture().detectChanges();
        expect(harness.component().isSidebarCollapsed()).toBe(false);
    });

    it('keeps overview EPG requests disabled by the global preference', async () => {
        await TestBed.inject(EpgPreferencesService).apply(false);
        harness.enterOverview();
        harness.applyMapping.mockClear();
        await harness.settle();

        expect(harness.ensureBulk()).not.toHaveBeenCalled();
        expect(harness.fetchShort()).not.toHaveBeenCalled();
        expect(harness.applyMapping).not.toHaveBeenCalled();
        expect(overview().showEpg()).toBe(false);
        expect(overview().epgPrograms().size).toBe(0);
    });

    it('replaces bulk preview snapshots when the overview reports a different rendered window', async () => {
        harness.enterOverview();
        await harness.settle();
        const initialPrograms = overview().epgPrograms();
        const initialProgress = overview().epgProgress();
        overview().visibleChannelsChanged.emit([overview().channels()[1]]);
        await harness.settle();

        expect([...overview().epgPrograms().keys()]).toEqual(['10002']);
        expect(overview().epgPrograms()).not.toBe(initialPrograms);
        expect(overview().epgProgress()).not.toBe(initialProgress);
        expect([...initialPrograms.keys()]).toEqual(['10001', '10002']);
        expect(harness.fetchShort()).not.toHaveBeenCalled();
    });

    it('reuses the throttled preview refresh for overview scrolling', async () => {
        harness.enterOverview();
        await harness.settle();
        const initialPrograms = overview().epgPrograms();
        overview().previewRefreshRequested.emit();
        overview().previewRefreshRequested.emit();
        harness.fixture().detectChanges();
        expect(overview().epgPrograms()).toBe(initialPrograms);

        await new Promise<void>((resolve) => setTimeout(resolve, 350));
        harness.fixture().detectChanges();
        expect(overview().epgPrograms()).not.toBe(initialPrograms);
        expect(overview().epgPrograms().get('10001')?.title).toBe(
            'Current Show'
        );
        expect(harness.fetchShort()).not.toHaveBeenCalled();
    });

    it('retires the old overview window before resolving EPG for another portal', async () => {
        harness.enterOverview();
        await harness.settle();
        harness.applyMapping.mockClear();
        harness.fetchShort().mockClear();

        // The old child is still mounted until the new portal supplies its list.
        harness.switchPlaylist();
        await harness.settle();

        expect(harness.component().overviewVisibleChannels()).toEqual([]);
        expect(overview().epgPrograms().size).toBe(0);
        expect(harness.applyMapping).not.toHaveBeenCalled();
        expect(harness.fetchShort()).not.toHaveBeenCalled();
    });

    it('publishes new overview map snapshots when the short EPG fallback completes', async () => {
        harness.enterOverview();
        harness.mockFutureOnlyBulkEpg();
        harness.fixture().detectChanges();
        const initialPrograms = overview().epgPrograms();
        const initialProgress = overview().epgProgress();
        await harness.settle();
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        harness.fixture().detectChanges();

        expect(overview().epgPrograms()).not.toBe(initialPrograms);
        expect(overview().epgProgress()).not.toBe(initialProgress);
        expect(initialPrograms.size).toBe(0);
        expect(overview().epgPrograms().get('10001')?.title).toBe('Now 10001');
        expect(overview().epgPrograms().get('10002')?.title).toBe('Now 10002');
        expect(overview().epgProgress().get('10002')).toBeGreaterThan(0);
    });
}
