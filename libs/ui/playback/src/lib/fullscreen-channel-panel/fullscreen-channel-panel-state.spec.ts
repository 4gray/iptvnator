import {
    CHANNEL_PANEL_CLOSE_GRACE_MS,
    CHANNEL_PANEL_OPEN_DWELL_MS,
    FullscreenChannelPanelState,
} from './fullscreen-channel-panel-state';

describe('FullscreenChannelPanelState', () => {
    let state: FullscreenChannelPanelState;

    beforeEach(() => {
        jest.useFakeTimers();
        state = new FullscreenChannelPanelState();
    });

    afterEach(() => {
        state.dispose();
        jest.useRealTimers();
    });

    it('opens once the mouse has rested in the hot zone', () => {
        state.hotZoneEnter();
        expect(state.open()).toBe(false);

        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS - 1);
        expect(state.open()).toBe(false);

        jest.advanceTimersByTime(1);
        expect(state.open()).toBe(true);
        expect(state.mounted()).toBe(true);
    });

    it('does not open when the mouse sweeps through the hot zone', () => {
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS - 1);
        state.hotZoneLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);

        expect(state.open()).toBe(false);
        expect(state.mounted()).toBe(false);
    });

    it('closes after the grace period once the mouse leaves the panel', () => {
        state.show();
        state.panelLeave();

        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS - 1);
        expect(state.open()).toBe(true);

        jest.advanceTimersByTime(1);
        expect(state.open()).toBe(false);
        // The list stays mounted so scroll position and search survive.
        expect(state.mounted()).toBe(true);
    });

    it('keeps the panel open when the mouse comes back before the grace period ends', () => {
        state.show();
        state.panelLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS - 1);
        state.panelEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);

        expect(state.open()).toBe(true);
    });

    it('ignores a panel leave while the panel is closed', () => {
        state.panelLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);

        expect(state.open()).toBe(false);
        expect(state.mounted()).toBe(false);
    });

    it('toggles between open and closed', () => {
        state.toggle();
        expect(state.open()).toBe(true);
        state.toggle();
        expect(state.open()).toBe(false);
        expect(state.mounted()).toBe(true);
    });

    it('cancels a pending hover open when hidden explicitly', () => {
        state.hotZoneEnter();
        state.hide();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);

        expect(state.open()).toBe(false);
    });

    it('reset forgets the mounted list and every pending timer', () => {
        state.show();
        state.panelLeave();
        state.reset();

        expect(state.open()).toBe(false);
        expect(state.mounted()).toBe(false);

        state.hotZoneEnter();
        state.reset();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(false);
    });
});
