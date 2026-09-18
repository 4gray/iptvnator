import {
    CHANNEL_PANEL_CLOSE_GRACE_MS,
    CHANNEL_PANEL_HINT_IDLE_MS,
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

    it('lets a keyboard-opened panel ignore the mouse until it has visited the panel', () => {
        state.show('keyboard');

        // Roaming over the video: no close.
        state.panelLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);
        expect(state.open()).toBe(true);

        // Once the pointer has been inside, leaving closes as usual.
        state.panelEnter();
        state.panelLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);
        expect(state.open()).toBe(false);
    });

    it('treats a hover-opened panel as engaged from the start', () => {
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(true);

        state.panelLeave();
        jest.advanceTimersByTime(CHANNEL_PANEL_CLOSE_GRACE_MS);
        expect(state.open()).toBe(false);
    });

    it('shows the edge hint while the pointer moves over the stage and hides it once idle', () => {
        state.stageActivity();
        expect(state.hintVisible()).toBe(true);

        jest.advanceTimersByTime(CHANNEL_PANEL_HINT_IDLE_MS - 1);
        state.stageActivity();
        jest.advanceTimersByTime(CHANNEL_PANEL_HINT_IDLE_MS - 1);
        expect(state.hintVisible()).toBe(true);

        jest.advanceTimersByTime(1);
        expect(state.hintVisible()).toBe(false);
    });

    it('arms the hint while the pointer rests in the hot zone and drops both on open', () => {
        state.hotZoneEnter();
        expect(state.hotZoneHover()).toBe(true);
        state.hotZoneLeave();
        expect(state.hotZoneHover()).toBe(false);

        state.stageActivity();
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(true);
        expect(state.hintVisible()).toBe(false);
        expect(state.hotZoneHover()).toBe(false);

        // Activity over the stage while open draws no hint.
        state.stageActivity();
        expect(state.hintVisible()).toBe(false);
    });

    it('does not reopen from the synthetic hot-zone enter that follows an explicit close', () => {
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(true);

        // Escape while the mouse still rests on the edge: the panel slides
        // away and the browser reports the zone under the pointer again.
        state.hide();
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(false);

        // A real move inside the zone starts the dwell again.
        state.stageActivity();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS - 1);
        expect(state.open()).toBe(false);
        jest.advanceTimersByTime(1);
        expect(state.open()).toBe(true);
    });

    it('re-arms the hot zone on a move made before the pointer reaches it', () => {
        state.show();
        state.hide();
        state.stageActivity();
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(true);
    });

    it('does not restart a running dwell on every move inside the zone', () => {
        state.hotZoneEnter();
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS - 10);
        state.stageActivity();
        jest.advanceTimersByTime(10);
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
        state.stageActivity();
        state.reset();
        expect(state.hotZoneHover()).toBe(false);
        expect(state.hintVisible()).toBe(false);
        jest.advanceTimersByTime(CHANNEL_PANEL_OPEN_DWELL_MS);
        expect(state.open()).toBe(false);
    });
});
