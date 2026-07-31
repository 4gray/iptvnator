import { Injectable, signal } from '@angular/core';
import {
    DEFAULT_LIVE_SIDEBAR_STATE,
    LIVE_SIDEBAR_STATE_STORAGE_KEY,
    LiveSidebarState,
    isLiveSidebarState,
} from '@iptvnator/portal/shared/util';

export const LIVE_LAYOUT_PANEL = {
    GROUPS: 'groups',
    CHANNELS: 'channels',
} as const;

export type LiveLayoutPanel =
    (typeof LIVE_LAYOUT_PANEL)[keyof typeof LIVE_LAYOUT_PANEL];

export type LivePanelState = LiveSidebarState;

export const LIVE_GROUPS_PANEL_STATE_STORAGE_KEY = 'live-groups-panel-state';
export const LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY =
    'live-channels-panel-state';

export interface LivePanelEffectiveContext {
    readonly applicable: boolean;
    readonly responsiveSuppressed?: boolean;
}

interface LiveLeftPanelIntents {
    readonly groups: LivePanelState;
    readonly channels: LivePanelState;
}

@Injectable({ providedIn: 'root' })
export class LiveLayoutPanelStateService {
    private readonly restoredIntents = restoreLiveLeftPanelIntents();
    private readonly _groupsIntent = signal(this.restoredIntents.groups);
    private readonly _channelsIntent = signal(this.restoredIntents.channels);
    private readonly _masterSuppressed = signal(false);

    readonly groupsIntent = this._groupsIntent.asReadonly();
    readonly channelsIntent = this._channelsIntent.asReadonly();
    readonly masterSuppressed = this._masterSuppressed.asReadonly();

    isPanelExpanded(
        panel: LiveLayoutPanel,
        context: LivePanelEffectiveContext
    ): boolean {
        return (
            context.applicable &&
            !context.responsiveSuppressed &&
            !this._masterSuppressed() &&
            this.intentFor(panel)() === 'expanded'
        );
    }

    hidePanel(panel: LiveLayoutPanel): void {
        this.setPanelIntent(panel, 'collapsed');
    }

    showPanel(panel: LiveLayoutPanel): void {
        this.setPanelIntent(panel, 'expanded');
    }

    toggleMasterSuppression(
        effectivelyVisiblePanels: readonly LiveLayoutPanel[]
    ): void {
        if (this._masterSuppressed()) {
            this._masterSuppressed.set(false);
            return;
        }

        this._masterSuppressed.set(effectivelyVisiblePanels.length > 0);
    }

    private setPanelIntent(
        panel: LiveLayoutPanel,
        state: LivePanelState
    ): void {
        this._masterSuppressed.set(false);
        const target =
            panel === LIVE_LAYOUT_PANEL.GROUPS
                ? this._groupsIntent
                : this._channelsIntent;
        target.set(state);
        localStorage.setItem(storageKeyFor(panel), state);
    }

    private intentFor(panel: LiveLayoutPanel) {
        return panel === LIVE_LAYOUT_PANEL.GROUPS
            ? this._groupsIntent
            : this._channelsIntent;
    }
}

function restoreLiveLeftPanelIntents(): LiveLeftPanelIntents {
    const legacyValue = localStorage.getItem(LIVE_SIDEBAR_STATE_STORAGE_KEY);
    const legacyFallback = isLiveSidebarState(legacyValue)
        ? legacyValue
        : DEFAULT_LIVE_SIDEBAR_STATE;
    const groups = restorePanelIntent(
        LIVE_GROUPS_PANEL_STATE_STORAGE_KEY,
        legacyFallback
    );
    const channels = restorePanelIntent(
        LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY,
        legacyFallback
    );

    localStorage.setItem(LIVE_GROUPS_PANEL_STATE_STORAGE_KEY, groups);
    localStorage.setItem(LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY, channels);

    return { groups, channels };
}

function restorePanelIntent(
    storageKey: string,
    fallback: LivePanelState
): LivePanelState {
    const storedValue = localStorage.getItem(storageKey);
    return isLiveSidebarState(storedValue) ? storedValue : fallback;
}

function storageKeyFor(panel: LiveLayoutPanel): string {
    return panel === LIVE_LAYOUT_PANEL.GROUPS
        ? LIVE_GROUPS_PANEL_STATE_STORAGE_KEY
        : LIVE_CHANNELS_PANEL_STATE_STORAGE_KEY;
}
