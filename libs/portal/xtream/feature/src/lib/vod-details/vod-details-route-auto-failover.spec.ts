import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { VodDetailsRouteComponent } from './vod-details-route.component';
import {
    configureVodDetailsRouteTestBed,
    createVodDetailsRouteStubs,
    resetVodDetailsRouteStubs,
    silenceRouteLogging,
} from './vod-details-route.harness';

/**
 * Who gets offered auto-failover, and what happens when the preference cannot
 * be stored. Split from the playback-actions spec to keep both inside the
 * repository's file-size rule.
 */
describe('VodDetailsRouteComponent — auto-failover', () => {
    let fixture: ComponentFixture<VodDetailsRouteComponent>;
    let restoreLogging: (() => void) | undefined;
    const stubs = createVodDetailsRouteStubs();
    const { selectedPlayer, snackBarOpen, updateSettings } = stubs;

    beforeEach(async () => {
        restoreLogging = silenceRouteLogging();
        resetVodDetailsRouteStubs(stubs);
        await configureVodDetailsRouteTestBed(stubs);

        fixture = TestBed.createComponent(VodDetailsRouteComponent);
    });

    afterEach(() => {
        restoreLogging?.();
    });

    beforeEach(() => {
        selectedPlayer.set(VideoPlayer.Html5Player);
        updateSettings.mockReset().mockResolvedValue(undefined);
        snackBarOpen.mockClear();
    });

    it.each([VideoPlayer.MPV, VideoPlayer.VLC, VideoPlayer.EmbeddedMpv])(
        'is not offered on %s',
        (player) => {
            // Those players never raise the playback diagnostic that
            // calls onPlaybackFailed(), so the switch could never happen.
            selectedPlayer.set(player);

            expect(fixture.componentInstance.autoFailoverSupported()).toBe(
                false
            );
        }
    );

    it.each([
        VideoPlayer.Html5Player,
        VideoPlayer.VideoJs,
        VideoPlayer.ArtPlayer,
    ])('is offered on %s', (player) => {
        selectedPlayer.set(player);

        expect(fixture.componentInstance.autoFailoverSupported()).toBe(
            true
        );
    });

    it('tells the user when the preference could not be stored', async () => {
        // updateSettings patches memory and REJECTS on a failed write, so
        // without this the toggle looks saved and silently reverts on the
        // next start — and the rejection is unhandled.
        updateSettings.mockRejectedValue(new Error('disk full'));

        fixture.componentInstance.setAutoFailover(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(snackBarOpen).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_SAVE_FAILED',
            'CLOSE',
            expect.anything()
        );
    });

    it('stays quiet when the write succeeds', async () => {
        fixture.componentInstance.setAutoFailover(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(updateSettings).toHaveBeenCalledWith({
            vodAutoFailover: true,
        });
        expect(snackBarOpen).not.toHaveBeenCalled();
    });
});
