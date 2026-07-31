import { TestBed } from '@angular/core/testing';
import { LIVE_SIDEBAR_STATE_STORAGE_KEY } from '@iptvnator/portal/shared/util';
import {
    LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY,
    LIVE_GROUPS_PANEL_STATE_STORAGE_KEY,
    LiveLayoutPanelStateService,
} from './live-layout-panel-state.service';

describe('LiveLayoutPanelStateService', () => {
    afterEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
    });

    it('defaults both panel intents to expanded and persists the migration', () => {
        const service = createService();

        expect(service.groupsIntent()).toBe('expanded');
        expect(service.channelsIntent()).toBe('expanded');
        expect(localStorage.getItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY)).toBe(
            'expanded'
        );
        expect(
            localStorage.getItem(LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY)
        ).toBe('expanded');
    });

    it('seeds missing panel intents from a valid legacy sidebar state', () => {
        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'collapsed');

        const service = createService();

        expect(service.groupsIntent()).toBe('collapsed');
        expect(service.channelsIntent()).toBe('collapsed');
        expect(localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );
    });

    it('keeps valid new keys and migrates only a missing or invalid sibling', () => {
        localStorage.setItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY, 'expanded');
        localStorage.setItem(LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY, 'hidden');
        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'collapsed');

        const service = createService();

        expect(service.groupsIntent()).toBe('expanded');
        expect(service.channelsIntent()).toBe('collapsed');
        expect(
            localStorage.getItem(LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY)
        ).toBe('collapsed');
    });

    it('does not let a changed legacy value overwrite migrated new keys', () => {
        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'collapsed');
        createService();
        TestBed.resetTestingModule();

        localStorage.setItem(LIVE_SIDEBAR_STATE_STORAGE_KEY, 'expanded');
        const service = createService();

        expect(service.groupsIntent()).toBe('collapsed');
        expect(service.channelsIntent()).toBe('collapsed');
    });

    it('persists Groups and Channels intents independently', () => {
        const service = createService();

        service.hidePanel('groups');

        expect(service.groupsIntent()).toBe('collapsed');
        expect(service.channelsIntent()).toBe('expanded');
        expect(localStorage.getItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );
        expect(
            localStorage.getItem(LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY)
        ).toBe('expanded');

        service.hidePanel('channels');
        service.showPanel('groups');

        expect(service.groupsIntent()).toBe('expanded');
        expect(service.channelsIntent()).toBe('collapsed');
    });

    it('resolves effective visibility without persisting applicability or responsive suppression', () => {
        const service = createService();

        expect(
            service.isPanelExpanded('groups', {
                applicable: true,
            })
        ).toBe(true);
        expect(
            service.isPanelExpanded('groups', {
                applicable: false,
            })
        ).toBe(false);
        expect(
            service.isPanelExpanded('groups', {
                applicable: true,
                responsiveSuppressed: true,
            })
        ).toBe(false);
        expect(service.groupsIntent()).toBe('expanded');
        expect(localStorage.getItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY)).toBe(
            'expanded'
        );
    });

    it('temporarily suppresses applicable visible panels and restores their persisted intents', () => {
        const service = createService();
        service.hidePanel('channels');

        service.toggleMasterSuppression(['groups']);

        expect(service.masterSuppressed()).toBe(true);
        expect(service.isPanelExpanded('groups', { applicable: true })).toBe(
            false
        );
        expect(service.groupsIntent()).toBe('expanded');
        expect(service.channelsIntent()).toBe('collapsed');

        service.toggleMasterSuppression([]);

        expect(service.masterSuppressed()).toBe(false);
        expect(service.isPanelExpanded('groups', { applicable: true })).toBe(
            true
        );
        expect(service.isPanelExpanded('channels', { applicable: true })).toBe(
            false
        );
    });

    it('exits master suppression before applying a panel-local action', () => {
        const service = createService();
        service.toggleMasterSuppression(['groups', 'channels']);

        service.showPanel('channels');

        expect(service.masterSuppressed()).toBe(false);
        expect(service.channelsIntent()).toBe('expanded');

        service.toggleMasterSuppression(['groups', 'channels']);
        service.hidePanel('groups');

        expect(service.masterSuppressed()).toBe(false);
        expect(service.groupsIntent()).toBe('collapsed');
    });

    it('leaves master suppression off when no panel is effectively visible', () => {
        const service = createService();

        service.toggleMasterSuppression([]);

        expect(service.masterSuppressed()).toBe(false);
        expect(service.groupsIntent()).toBe('expanded');
        expect(service.channelsIntent()).toBe('expanded');
    });
});

function createService(): LiveLayoutPanelStateService {
    TestBed.configureTestingModule({});
    return TestBed.inject(LiveLayoutPanelStateService);
}
