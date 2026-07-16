import { VjsPlayerResetCoordinator } from './vjs-player-reset-coordinator';
import type { VideoJsPlayer } from './vjs-player.types';

describe('VjsPlayerResetCoordinator', () => {
    it('waits for pause before reset and coalesces later requests', () => {
        const harness = createHarness(false);
        const coordinator = createCoordinator(harness);

        coordinator.requestReset();
        coordinator.requestReset();

        expect(harness.pause).toHaveBeenCalledTimes(1);
        expect(harness.reset).not.toHaveBeenCalled();

        harness.paused = true;
        coordinator.handlePause();

        expect(harness.reset).toHaveBeenCalledTimes(1);

        coordinator.requestReset();
        expect(harness.reset).toHaveBeenCalledTimes(1);
    });

    it('captures the latest engine volume after an asynchronous pause', () => {
        const harness = createHarness(false, 0.3);
        const coordinator = createCoordinator(harness);

        coordinator.requestReset();
        harness.player.volume(0.8);
        harness.paused = true;
        coordinator.handlePause();

        expect(coordinator.handlePlayerReset()).toBe(0.8);
    });

    it('snapshots actual engine volume and suppresses reset-generated changes', () => {
        const harness = createHarness(true, 0.3);
        const coordinator = createCoordinator(harness, 0.8);

        coordinator.requestReset();

        expect(coordinator.shouldSuppressVolumeChange()).toBe(true);
        expect(coordinator.handlePlayerReset()).toBe(0.3);
        expect(coordinator.shouldSuppressVolumeChange()).toBe(false);
    });

    it('cancels a pending reset but reports an in-flight reset to the caller', () => {
        const waitingHarness = createHarness(false);
        const waiting = createCoordinator(waitingHarness);
        waiting.requestReset();

        expect(waiting.cancelPendingReset()).toBe(false);
        waitingHarness.paused = true;
        waiting.handlePause();
        expect(waitingHarness.reset).not.toHaveBeenCalled();

        const activeHarness = createHarness(true);
        const active = createCoordinator(activeHarness);
        active.requestReset();

        expect(active.cancelPendingReset()).toBe(true);
    });

    it('tracks whether the current Tech already has its desired source', () => {
        const coordinator = createCoordinator(createHarness(true));

        expect(coordinator.canApplyReadySource()).toBe(true);
        coordinator.markSourceApplied();
        expect(coordinator.canApplyReadySource()).toBe(false);

        coordinator.handlePlayerReset();
        expect(coordinator.canApplyReadySource()).toBe(true);
    });
});

function createCoordinator(
    harness: ReturnType<typeof createHarness>,
    fallbackVolume = 1
): VjsPlayerResetCoordinator {
    return new VjsPlayerResetCoordinator({
        player: () => harness.player,
        fallbackVolume: () => fallbackVolume,
        queueTask: (callback) => harness.tasks.push(callback),
        reportError: harness.reportError,
    });
}

function createHarness(paused: boolean, initialVolume = 0.5) {
    let volume = initialVolume;
    const harness = {
        paused,
        tasks: [] as Array<() => void>,
        pause: jest.fn(),
        reset: jest.fn(),
        reportError: jest.fn(),
        player: null as unknown as VideoJsPlayer,
    };
    harness.player = {
        pause: harness.pause,
        paused: jest.fn(() => harness.paused),
        reset: harness.reset,
        volume: jest.fn((value?: number) => {
            if (value !== undefined) {
                volume = value;
            }
            return volume;
        }),
    } as unknown as VideoJsPlayer;
    return harness;
}
