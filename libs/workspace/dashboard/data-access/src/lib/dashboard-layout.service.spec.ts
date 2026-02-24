import { TestBed } from '@angular/core/testing';
import { DashboardWidgetScopeSettings } from './dashboard-widget.model';
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

    it('normalizes scope providers and playlist ids when setting scope', () => {
        service.setWidgetScope('recently-watched', {
            providers: ['xtream', 'xtream', 'invalid'],
            playlistIds: ['playlist-a', '', 'playlist-a'],
        } as unknown as DashboardWidgetScopeSettings);

        const widget = service.getWidget('recently-watched');
        expect(widget?.settings?.scope).toEqual({
            providers: ['xtream'],
            playlistIds: ['playlist-a'],
        });
    });

    it('allows an empty provider list to represent all providers', () => {
        service.setWidgetScope('recently-watched', {
            providers: ['m3u'],
            playlistIds: [],
        });
        service.toggleWidgetScopeProvider('recently-watched', 'm3u');

        const providers =
            service.getWidget('recently-watched')?.settings?.scope?.providers ?? [];
        expect(providers).toEqual([]);
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
        expect(sourceStats?.enabled).toBe(false);
    });
});
