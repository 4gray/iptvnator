import { Signal, computed } from '@angular/core';
import { EmbeddedMpvAudioTrack } from '@iptvnator/shared/interfaces';
import { ASPECT_PRESETS, SPEED_PRESETS } from './embedded-mpv-format.utils';
import type { EmbeddedMpvMenuState } from './embedded-mpv-ui-state';

export type EmbeddedMpvDockPanelKind =
    | 'audio'
    | 'subtitle'
    | 'speed'
    | 'aspect';

export interface EmbeddedMpvDockChip {
    readonly id: string;
    readonly label: string;
    readonly selected: boolean;
}

export interface EmbeddedMpvDockPanelView {
    readonly kind: EmbeddedMpvDockPanelKind;
    readonly title: string;
    readonly chips: readonly EmbeddedMpvDockChip[];
}

/** Chip id representing the "subtitles off" (-1) selection. */
export const SUBTITLES_OFF_CHIP_ID = 'off';

export interface EmbeddedMpvDockPanelDeps {
    readonly menus: EmbeddedMpvMenuState;
    readonly audioTracks: Signal<EmbeddedMpvAudioTrack[]>;
    readonly subtitleTracks: Signal<EmbeddedMpvAudioTrack[]>;
    readonly selectedSubtitleTrackId: Signal<number | null>;
    readonly playbackSpeed: Signal<number>;
    readonly aspectOverride: Signal<string>;
    readonly translateLabel: (key: string) => string;
    readonly audioTrackLabel: (
        track: EmbeddedMpvAudioTrack,
        index: number
    ) => string;
    readonly subtitleTrackLabel: (
        track: EmbeddedMpvAudioTrack,
        index: number
    ) => string;
    readonly aspectLabel: (aspect: string) => string;
    readonly selectAudioTrack: (trackId: number) => void;
    readonly selectSubtitleTrack: (trackId: number) => void;
    readonly selectSpeed: (speed: number) => void;
    readonly selectAspect: (aspect: string) => void;
    readonly closePanels: () => void;
    readonly playerRoot: () => HTMLElement | null;
    readonly revealControls: () => void;
}

/**
 * View model for the horizontal in-dock chip panels of the native-view
 * embedded MPV dock (audio, subtitle, speed, aspect). The panels morph the
 * controls row inside its fixed-height strip, so opening one never changes
 * the native MPV view bounds — unlike the removed popover-era bottom cutout.
 */
export class EmbeddedMpvDockPanelState {
    readonly active: Signal<EmbeddedMpvDockPanelView | null>;

    private openerKind: EmbeddedMpvDockPanelKind | null = null;

    constructor(private readonly deps: EmbeddedMpvDockPanelDeps) {
        this.active = computed(() => this.buildActivePanel());
    }

    toggle(kind: EmbeddedMpvDockPanelKind): void {
        this.openerKind = this.deps.menus.dockPanelOpen() ? null : kind;
        this.deps.menus.toggle(kind);
        this.deps.revealControls();
    }

    /**
     * Call whenever `menus.dockPanelOpen()` changes. When a panel closes it
     * takes keyboard focus down with it (the dock row re-renders, so the
     * pre-open button instance no longer exists); focus is handed to the
     * freshly rendered toggle button of the menu that was open.
     */
    handlePanelOpenChange(panelOpen: boolean): void {
        if (panelOpen) {
            return;
        }
        const kind = this.openerKind;
        this.openerKind = null;
        if (!kind) {
            return;
        }
        queueMicrotask(() => this.restoreOpenerFocus(kind));
    }

    select(chipId: string): void {
        const panel = this.active();
        if (!panel) {
            return;
        }
        switch (panel.kind) {
            case 'audio':
                this.deps.selectAudioTrack(Number(chipId));
                return;
            case 'subtitle':
                this.deps.selectSubtitleTrack(
                    chipId === SUBTITLES_OFF_CHIP_ID ? -1 : Number(chipId)
                );
                return;
            case 'speed':
                this.deps.selectSpeed(Number(chipId));
                return;
            case 'aspect':
                this.deps.selectAspect(chipId);
                return;
        }
    }

    close(): void {
        this.deps.closePanels();
    }

    private restoreOpenerFocus(kind: EmbeddedMpvDockPanelKind): void {
        if (
            document.activeElement !== document.body &&
            document.activeElement !== null
        ) {
            return;
        }
        this.deps
            .playerRoot()
            ?.querySelector<HTMLElement>(
                `[data-embedded-mpv-menu-button="${kind}"]`
            )
            ?.focus();
    }

    private buildActivePanel(): EmbeddedMpvDockPanelView | null {
        const { menus } = this.deps;
        if (menus.audioOpen()) {
            return {
                kind: 'audio',
                title: this.deps.translateLabel(
                    'EMBEDDED_MPV.PLAYER.AUDIO_TRACKS'
                ),
                chips: this.deps
                    .audioTracks()
                    .map((track, index) => ({
                        id: String(track.id),
                        label: this.deps.audioTrackLabel(track, index),
                        selected: track.selected === true,
                    })),
            };
        }
        if (menus.subtitleOpen()) {
            return {
                kind: 'subtitle',
                title: this.deps.translateLabel('EMBEDDED_MPV.PLAYER.SUBTITLES'),
                chips: [
                    {
                        id: SUBTITLES_OFF_CHIP_ID,
                        label: this.deps.translateLabel(
                            'EMBEDDED_MPV.PLAYER.SUBTITLES_OFF'
                        ),
                        selected: this.deps.selectedSubtitleTrackId() === null,
                    },
                    ...this.deps.subtitleTracks().map((track, index) => ({
                        id: String(track.id),
                        label: this.deps.subtitleTrackLabel(track, index),
                        selected: track.selected === true,
                    })),
                ],
            };
        }
        if (menus.speedOpen()) {
            const speed = this.deps.playbackSpeed();
            return {
                kind: 'speed',
                title: this.deps.translateLabel(
                    'EMBEDDED_MPV.PLAYER.PLAYBACK_SPEED'
                ),
                chips: SPEED_PRESETS.map((preset) => ({
                    id: String(preset.value),
                    label: preset.label,
                    selected: preset.value === speed,
                })),
            };
        }
        if (menus.aspectOpen()) {
            const aspect = this.deps.aspectOverride();
            return {
                kind: 'aspect',
                title: this.deps.translateLabel(
                    'EMBEDDED_MPV.PLAYER.ASPECT_RATIO'
                ),
                chips: ASPECT_PRESETS.map((preset) => ({
                    id: preset.value,
                    label: this.deps.aspectLabel(preset.value),
                    selected: preset.value === aspect,
                })),
            };
        }
        return null;
    }
}
