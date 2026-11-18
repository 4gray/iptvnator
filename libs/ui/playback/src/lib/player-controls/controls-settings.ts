import { Signal, computed } from '@angular/core';
import type { ControlsMenuState } from './controls-menu-state';
import {
    anySettingsGroupAvailable,
    getSettingsGroupAvailability,
} from './controls-settings-groups';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

export interface ControlsSettingsDeps {
    state: Signal<PlayerControlsState>;
    capabilities: Signal<PlayerControlsCapabilities>;
    showControls: Signal<boolean>;
    menus: ControlsMenuState;
    reveal: (options?: { scheduleHide?: boolean }) => void;
}

/** Colored state dots on the `tune` button. */
export interface SettingsStateDots {
    /** Something is on: subtitles enabled, a non-default audio track. */
    cyan: boolean;
    /** A value was changed: speed, aspect ratio, manual quality. */
    violet: boolean;
}

/**
 * State behind the `tune` button and the settings panel: which
 * groups exist, what is on or modified (the color-as-state system), and the
 * open/close/toggle transitions. The panel itself only renders.
 */
export class ControlsSettings {
    constructor(private readonly deps: ControlsSettingsDeps) {}

    readonly groups = computed(() =>
        getSettingsGroupAvailability(
            this.deps.capabilities(),
            this.deps.state()
        )
    );

    readonly available = computed(
        () =>
            this.deps.showControls() && anySettingsGroupAvailable(this.groups())
    );

    readonly isOpen = computed(
        () => this.available() && this.deps.menus.settingsOpen()
    );

    readonly subtitlesOn = computed(
        () => this.groups().subtitles && this.deps.state().subtitlesEnabled
    );

    /** A track other than the first (the engine's default) is selected. */
    readonly audioModified = computed(() => {
        if (!this.groups().audio) {
            return false;
        }
        const tracks = this.deps.state().audioTracks;
        const selected = tracks.findIndex((track) => track.selected);
        return selected > 0;
    });

    readonly qualityModified = computed(
        () => this.groups().quality && !this.deps.state().qualityAutoEnabled
    );

    readonly speedModified = computed(
        () => this.groups().speed && this.deps.state().playbackSpeed !== 1
    );

    readonly defaultAspect = computed(
        () => this.deps.state().aspectPresets[0]?.value ?? 'no'
    );

    readonly aspectModified = computed(
        () =>
            this.groups().aspect &&
            this.deps.state().aspectRatio !== this.defaultAspect()
    );

    readonly dots = computed<SettingsStateDots>(() => ({
        cyan: this.subtitlesOn() || this.audioModified(),
        violet:
            this.speedModified() ||
            this.aspectModified() ||
            this.qualityModified(),
    }));

    readonly hasDots = computed(() => this.dots().cyan || this.dots().violet);

    toggle(): void {
        if (!this.available()) {
            return;
        }
        this.deps.reveal();
        this.deps.menus.toggle('settings');
    }

    close(): void {
        this.deps.menus.close('settings');
        this.deps.reveal();
    }
}
