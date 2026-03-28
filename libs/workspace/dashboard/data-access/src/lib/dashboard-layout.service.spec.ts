import { TestBed } from '@angular/core/testing';
import { DashboardLayoutService } from './dashboard-layout.service';

const STORAGE_KEY = 'workspace-dashboard-layout-v3';

describe('DashboardLayoutService', () => {
    let service: DashboardLayoutService;

    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
        TestBed.configureTestingModule({
            providers: [DashboardLayoutService],
        });
        service = TestBed.inject(DashboardLayoutService);
    });

    afterEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('persists layout changes to localStorage', () => {
        service.toggleWidget('source-stats');
        TestBed.flushEffects();

        const stored = localStorage.getItem(STORAGE_KEY);
        expect(stored).toBeTruthy();

        const parsed = JSON.parse(stored ?? '{}') as {
            widgets?: Array<{ id: string; enabled: boolean }>;
        };
        const sourceStats = parsed.widgets?.find((widget) => widget.id === 'source-stats');
        expect(sourceStats?.enabled).toBe(true);
    });

    it('adds the recently added widget disabled by default during normalization', () => {
        const widget = service.getWidget('recently-added');

        expect(widget).toEqual(
            expect.objectContaining({
                type: 'recently-added',
                enabled: false,
                size: 'half',
            })
        );
        expect((widget as { settings?: unknown } | undefined)?.settings).toBeUndefined();
    });
});
