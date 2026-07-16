import { ControlsVolume } from './controls-volume';
import type { PlayerController } from './player-controls.model';

describe('ControlsVolume', () => {
    let applied: number[];
    let flashes: Array<{ icon: string; label: string }>;
    let openCount: number;
    let closeCount: number;
    let volume: ControlsVolume;

    beforeEach(() => {
        localStorage.clear();
        applied = [];
        flashes = [];
        openCount = 0;
        closeCount = 0;
        volume = new ControlsVolume({
            apply: (value) => applied.push(value),
            flash: (icon, label) => flashes.push({ icon, label }),
            mutedLabel: () => 'Stumm',
            openPopover: () => (openCount += 1),
            closePopover: () => (closeCount += 1),
        });
    });

    afterEach(() => {
        volume.dispose();
        jest.useRealTimers();
    });

    it('set updates the signal, persists, and applies', () => {
        volume.set(0.4);
        expect(volume.value()).toBe(0.4);
        expect(localStorage.getItem('volume')).toBe('0.4');
        expect(applied).toEqual([0.4]);
    });

    it('clamps set values to [0, 1]', () => {
        volume.set(2);
        expect(volume.value()).toBe(1);
        volume.set(-1);
        expect(volume.value()).toBe(0);
    });

    it('adjust changes value and flashes percentage', () => {
        volume.set(0.5);
        flashes = [];
        volume.adjust(0.1);
        expect(volume.value()).toBeCloseTo(0.6);
        expect(flashes.at(-1)?.label).toBe('60%');
    });

    it('toggleMute stores and restores the previous volume', () => {
        volume.set(0.8);
        volume.toggleMute();
        expect(volume.value()).toBe(0);
        expect(flashes.at(-1)).toEqual({ icon: 'volume_off', label: 'Stumm' });

        volume.toggleMute();
        expect(volume.value()).toBe(0.8);
    });

    it('toggleMute restores a default when nothing was muted from', () => {
        volume.set(0);
        flashes = [];
        volume.toggleMute();
        expect(volume.value()).toBe(0.5);
    });

    it('reconcile sets the value without persisting or applying', () => {
        volume.reconcile(0.25);
        expect(volume.value()).toBe(0.25);
        expect(applied).toEqual([]);
        expect(localStorage.getItem('volume')).toBeNull();
    });

    it('uses the first controller snapshot when no volume is persisted', () => {
        const controller = {} as PlayerController;

        volume.initializeController(controller, 0.4);

        expect(volume.value()).toBe(0.4);
        expect(applied).toEqual([]);
    });

    it('applies persisted volume before accepting a later controller snapshot', () => {
        const controller = {} as PlayerController;
        volume.set(0.3);
        applied = [];

        volume.initializeController(controller, 1);
        volume.reconcileController(controller, 1);

        expect(applied).toEqual([0.3]);
        expect(volume.value()).toBe(0.3);

        volume.reconcileController(controller, 0.5);
        expect(volume.value()).toBe(0.5);
    });

    it('reapplies persisted volume after a controller capability epoch resets', () => {
        const controller = {} as PlayerController;
        volume.set(0.3);
        applied = [];
        volume.initializeController(controller, 1);
        volume.deactivateController(controller);

        volume.initializeController(controller, 1);

        expect(applied).toEqual([0.3, 0.3]);
        expect(volume.value()).toBe(0.3);
    });

    it('hoverEnter opens the popover and cancels any pending close', () => {
        jest.useFakeTimers();
        volume.hoverLeave();
        volume.hoverEnter();
        jest.runAllTimers();
        expect(openCount).toBe(1);
        expect(closeCount).toBe(0);
    });

    it('hoverLeave closes the popover after a delay', () => {
        jest.useFakeTimers();
        volume.hoverLeave();
        expect(closeCount).toBe(0);
        jest.runAllTimers();
        expect(closeCount).toBe(1);
    });
});
