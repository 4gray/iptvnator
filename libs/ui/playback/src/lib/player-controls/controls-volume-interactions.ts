import type { ControlsMenuState } from './controls-menu-state';
import type { ControlsVolume } from './controls-volume';

export interface ControlsVolumeInteractionsDeps {
    volume: ControlsVolume;
    menus: ControlsMenuState;
    /** Pointer-type attribution, provided by the surface. */
    wasTouchInteraction: (event?: Event) => boolean;
    /** Whether the controller advertises the volume capability. */
    canAdjustVolume: () => boolean;
    reveal: (options?: { scheduleHide?: boolean }) => void;
}

/**
 * Pointer-type-aware wiring between the volume button/popover template events
 * and {@link ControlsVolume}. With a mouse, hovering the button opens the
 * slider popover and clicking toggles mute. Touch has no hover, so the
 * synthetic pointerenter/focusin a tap fires is ignored and the first tap on
 * the button opens the popover instead of muting; a tap while it is open
 * toggles mute as the button's label says.
 */
export class ControlsVolumeInteractions {
    constructor(private readonly deps: ControlsVolumeInteractionsDeps) {}

    hoverEnter(event?: Event): void {
        if (this.deps.wasTouchInteraction(event)) {
            return;
        }
        this.deps.volume.hoverEnter();
    }

    hoverLeave(event?: Event): void {
        if (this.deps.wasTouchInteraction(event)) {
            return;
        }
        this.deps.volume.hoverLeave();
    }

    buttonClick(event?: Event): void {
        if (
            this.deps.wasTouchInteraction(event) &&
            !this.deps.menus.volumeOpen()
        ) {
            this.deps.volume.hoverEnter();
            this.deps.reveal({ scheduleHide: false });
            return;
        }
        this.toggleMute();
    }

    sliderInput(event: Event): void {
        this.deps.volume.set(Number((event.target as HTMLInputElement).value));
        this.deps.reveal({ scheduleHide: false });
    }

    wheel(event: WheelEvent): void {
        event.preventDefault();
        this.adjust(event.deltaY > 0 ? -0.05 : 0.05);
    }

    toggleMute(): void {
        if (!this.deps.canAdjustVolume()) {
            return;
        }
        this.deps.volume.toggleMute();
        this.deps.reveal();
    }

    adjust(delta: number): void {
        if (!this.deps.canAdjustVolume()) {
            return;
        }
        this.deps.volume.adjust(delta);
        this.deps.reveal();
    }
}
