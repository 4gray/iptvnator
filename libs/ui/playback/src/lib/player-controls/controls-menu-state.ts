import { computed, signal } from '@angular/core';
import {
    anySettingsGroupAvailable,
    getSettingsGroupAvailability,
    type SettingsGroup,
} from './controls-settings-groups';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

const CONTROL_MENUS = ['volume', 'settings', 'stats'] as const;

export type ControlsMenu = (typeof CONTROL_MENUS)[number];
export type ControlsMenuAvailability = Readonly<Record<ControlsMenu, boolean>>;

function getControlsMenuAvailability(
    showControls: boolean,
    capabilities: PlayerControlsCapabilities,
    state: PlayerControlsState
): ControlsMenuAvailability {
    return {
        volume: showControls && capabilities.volume,
        settings:
            showControls &&
            anySettingsGroupAvailable(
                getSettingsGroupAvailability(capabilities, state)
            ),
        stats: showControls && capabilities.streamStats,
    };
}

/**
 * Tracks which menu/popover is currently open and exposes individual signals
 * the template binds to. Only one menu can be open at a time. The settings
 * panel is one menu: every track, quality, speed and aspect choice lives
 * inside it, and `settingsFocus` names the group it was opened for (a chip
 * click), so the panel can bring that group into view.
 */
export class ControlsMenuState {
    readonly volumeOpen = signal(false);
    readonly settingsOpen = signal(false);
    readonly statsOpen = signal(false);
    readonly settingsFocus = signal<SettingsGroup | null>(null);

    readonly anyOpen = computed(
        () => this.volumeOpen() || this.settingsOpen() || this.statsOpen()
    );

    toggle(menu: ControlsMenu): void {
        const target = this.signalFor(menu);
        const next = !target();
        this.closeAll();
        target.set(next);
    }

    open(menu: ControlsMenu): void {
        if (this.signalFor(menu)()) {
            return;
        }
        this.closeAll();
        this.signalFor(menu).set(true);
    }

    /** Opens the settings panel on one group (or wherever it was). */
    openSettings(group: SettingsGroup | null = null): void {
        this.open('settings');
        this.settingsFocus.set(group);
    }

    close(menu: ControlsMenu): void {
        this.signalFor(menu).set(false);
        if (menu === 'settings') {
            this.settingsFocus.set(null);
        }
    }

    closeAll(): void {
        this.volumeOpen.set(false);
        this.settingsOpen.set(false);
        this.statsOpen.set(false);
        this.settingsFocus.set(null);
    }

    reconcile(availability: ControlsMenuAvailability): boolean {
        let changed = false;
        for (const menu of CONTROL_MENUS) {
            const open = this.signalFor(menu);
            if (open() && !availability[menu]) {
                this.close(menu);
                changed = true;
            }
        }
        return changed;
    }

    reconcileControllerAvailability(
        showControls: boolean,
        capabilities: PlayerControlsCapabilities,
        state: PlayerControlsState
    ): boolean {
        return this.reconcile(
            getControlsMenuAvailability(showControls, capabilities, state)
        );
    }

    private signalFor(menu: ControlsMenu) {
        switch (menu) {
            case 'volume':
                return this.volumeOpen;
            case 'settings':
                return this.settingsOpen;
            case 'stats':
                return this.statsOpen;
        }
    }
}
