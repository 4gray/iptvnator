import {
    EPG_GUIDE_DENSITY_KEY,
    EPG_GUIDE_DOCK_COLLAPSED_KEY,
    EPG_GUIDE_ONLY_WITH_EPG_KEY,
    EPG_GUIDE_ZOOM_KEY,
    persistEpgGuideDockCollapsed,
    persistEpgGuidePreferences,
    restoreEpgGuideDockCollapsed,
    restoreEpgGuidePreferences,
} from './epg-guide-preferences';
import { EPG_GUIDE_ZOOM_DEFAULT } from './epg-guide-layout.util';

describe('epg-guide-preferences', () => {
    beforeEach(() => localStorage.clear());

    it('falls back to comfortable density, default zoom and the toggle off', () => {
        expect(restoreEpgGuidePreferences()).toEqual({
            density: 'comfortable',
            zoom: EPG_GUIDE_ZOOM_DEFAULT,
            onlyWithEpg: false,
        });
        expect(restoreEpgGuideDockCollapsed()).toBe(false);
    });

    it('round-trips every preference and clamps the zoom', () => {
        persistEpgGuidePreferences({
            density: 'compact',
            zoom: 9_999,
            onlyWithEpg: true,
        });
        persistEpgGuideDockCollapsed(true);
        expect(localStorage.getItem(EPG_GUIDE_DENSITY_KEY)).toBe('compact');
        expect(localStorage.getItem(EPG_GUIDE_ONLY_WITH_EPG_KEY)).toBe('1');
        expect(localStorage.getItem(EPG_GUIDE_DOCK_COLLAPSED_KEY)).toBe('1');
        expect(restoreEpgGuidePreferences()).toEqual({
            density: 'compact',
            zoom: 480,
            onlyWithEpg: true,
        });
        expect(restoreEpgGuideDockCollapsed()).toBe(true);
    });

    it('ignores corrupt stored values', () => {
        localStorage.setItem(EPG_GUIDE_DENSITY_KEY, 'huge');
        localStorage.setItem(EPG_GUIDE_ZOOM_KEY, 'abc');
        expect(restoreEpgGuidePreferences().density).toBe('comfortable');
        expect(restoreEpgGuidePreferences().zoom).toBe(EPG_GUIDE_ZOOM_DEFAULT);
    });

    it('survives a throwing storage', () => {
        const broken = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
        } as unknown as Storage;
        expect(() =>
            persistEpgGuidePreferences(
                { density: 'compact', zoom: 200, onlyWithEpg: false },
                broken
            )
        ).not.toThrow();
        expect(restoreEpgGuidePreferences(broken).density).toBe('comfortable');
    });
});
