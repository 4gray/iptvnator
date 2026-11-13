import type { ControlsMenuState } from './controls-menu-state';
import type { ControlsVolume } from './controls-volume';

export interface ControlsVolumeInteractionsDeps {
    volume: ControlsVolume;
    menus: ControlsMenuState;
    /** Pointer-type attribution, provided by the surface. */
    wasTouchInteraction: (event?: Event) => boolean;
    /** Whether a pointerenter is a tap's emulated hover, provided by the surface. */
    isEmulatedHover: (event?: Event) => boolean;
    /**
     * Whether the `focusout` being dispatched is the surface releasing the
     * focus a pointer click left on a control. The pointer is still over the
     * anchor, so the popover must not schedule its close on it.
     */
    wasPointerFocusRelease: () => boolean;
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

    /**
     * Pointer hover on the anchor. After a tap Chromium may dispatch a
     * mouse-typed pointerenter on the anchor fading in under the finger, with
     * no pointerleave to follow; opening the popover on it would keep the
     * controls up for good. Focus keeps its own path (`hoverEnter`).
     */
    pointerEnter(event?: Event): void {
        if (this.deps.isEmulatedHover(event)) {
            return;
        }
        this.deps.volume.hoverEnter();
    }

    /**
     * A real mouse moving over the anchor opens the popover when its enter
     * landed inside a touch press's window and was ignored, the same recovery
     * the chrome bar has; once open, moves change nothing.
     */
    pointerMove(event?: Event): void {
        if (this.deps.menus.volumeOpen() || this.deps.isEmulatedHover(event)) {
            return;
        }
        this.deps.volume.hoverEnter();
    }

    hoverLeave(event?: Event): void {
        if (
            this.deps.wasTouchInteraction(event) ||
            this.deps.wasPointerFocusRelease()
        ) {
            return;
        }
        this.deps.volume.hoverLeave();
    }

    /**
     * With the slider rendered inline next to the button (wide dock), there
     * is no popover to open first: the button is plainly a mute toggle for
     * every pointer type.
     */
    buttonClick(event?: Event, options: { inlineSlider?: boolean } = {}): void {
        if (
            !options.inlineSlider &&
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
