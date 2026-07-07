import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_ASPECT_PRESETS,
    DEFAULT_SPEED_PRESETS,
    DEFAULT_PLAYER_CAPABILITIES,
} from '../player-controls';
import type {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerStatus,
    PlayerTrack,
} from '../player-controls';
import { readStoredVolume } from '../player-controls';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';
import { audioTrackLabel, subtitleTrackLabel } from './embedded-mpv-labels';

const RECORDING_MESSAGE_DISMISS_DELAY_MS = 5000;

/**
 * Bridges the engine-specific {@link EmbeddedMpvSessionController} onto the
 * generic {@link PlayerController} contract consumed by the shared
 * `app-player-controls` component. The host component pushes reactive context
 * (playback / series navigation / recording folder) into the writable signals.
 */
@Injectable()
export class EmbeddedMpvControlsAdapter implements PlayerController {
    private readonly controller = inject(EmbeddedMpvSessionController);
    private readonly translate = inject(TranslateService);

    /** Bumped on language changes so track labels re-localize reactively. */
    private readonly translationsTick = signal(0);

    /** Host-pushed context. */
    readonly playback = signal<ResolvedPortalPlayback | null>(null);
    readonly seriesNavigation = signal<SeriesPlaybackNavigation | null>(null);
    readonly recordingFolder = signal('');

    private readonly recordingTick = signal(Date.now());
    private readonly recordingMessage = signal<string | null>(null);
    private recordingMessageTimer: number | null = null;

    private readonly isLive = computed(() => {
        const playback = this.playback();
        if (!playback) {
            return false;
        }
        if (typeof playback.isLive === 'boolean') {
            return playback.isLive;
        }
        return !playback.contentInfo;
    });

    readonly capabilities = computed<PlayerControlsCapabilities>(() => {
        const support = this.controller.support();
        const caps = support?.capabilities;
        return {
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
            volume: true,
            audioTracks: true,
            fullscreen: true,
            subtitles: caps?.subtitles ?? false,
            playbackSpeed: caps?.playbackSpeed ?? false,
            aspectRatio: caps?.aspectOverride ?? false,
            recording: caps?.recording ?? false,
            seriesNavigation:
                !this.isLive() && this.seriesNavigation() !== null,
        };
    });

    readonly state = computed<PlayerControlsState>(() => {
        const session = this.controller.session();
        const support = this.controller.support();
        const supported = support?.supported ?? false;
        const isLive = this.isLive();
        const durationSeconds = session?.durationSeconds ?? null;
        const seriesNav = this.seriesNavigation();
        const seriesNavCapable = !isLive && seriesNav !== null;

        this.translationsTick();
        const audioTracks: PlayerTrack[] = (session?.audioTracks ?? []).map(
            (track, index) => ({
                id: track.id,
                label: audioTrackLabel(track, index, {
                    fallback: this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.AUDIO_TRACK_FALLBACK',
                        { index: index + 1 }
                    ),
                    defaultLabel: this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.TRACK_DEFAULT'
                    ),
                }),
                selected: track.selected,
            })
        );
        const subtitleTracks: PlayerTrack[] = (
            session?.subtitleTracks ?? []
        ).map((track, index) => ({
            id: track.id,
            label: subtitleTrackLabel(track, index, {
                fallback: this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.SUBTITLE_TRACK_FALLBACK',
                    { index: index + 1 }
                ),
                defaultLabel: this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.TRACK_DEFAULT'
                ),
            }),
            selected: track.selected,
        }));

        return {
            status: this.mapStatus(session?.status, supported, support),
            statusMessage: this.statusMessage(),
            stalled: this.controller.stalled(),
            positionSeconds: Math.max(0, session?.positionSeconds ?? 0),
            durationSeconds,
            isLive,
            canSeek: !isLive && (durationSeconds ?? 0) > 0,
            volume: session?.volume ?? readStoredVolume(),
            audioTracks,
            subtitleTracks,
            subtitlesEnabled:
                (session?.selectedSubtitleTrackId ?? null) !== null,
            playbackSpeed: session?.playbackSpeed ?? 1,
            speedPresets: DEFAULT_SPEED_PRESETS,
            aspectRatio: session?.aspectOverride ?? 'no',
            aspectPresets: DEFAULT_ASPECT_PRESETS,
            recording: {
                active: session?.recording?.active ?? false,
                elapsedSeconds: this.recordingElapsed(),
                message: this.recordingMessage(),
            },
            canPreviousEpisode:
                seriesNavCapable && seriesNav?.canPrevious === true,
            canNextEpisode: seriesNavCapable && seriesNav?.canNext === true,
        };
    });

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => void this.controller.togglePaused(),
        seekTo: (seconds) => void this.controller.seekTo(seconds),
        seekBy: (delta) => void this.controller.seekBy(delta),
        setVolume: (value) => void this.controller.applyVolume(value),
        setAudioTrack: (id) => void this.controller.setAudioTrack(id),
        setSubtitleTrack: (id) => void this.controller.setSubtitleTrack(id),
        setPlaybackSpeed: (speed) => void this.controller.setSpeed(speed),
        setAspectRatio: (value) => void this.controller.setAspect(value),
        toggleRecording: () => void this.toggleRecording(),
    };

    constructor() {
        this.translate.onLangChange.subscribe(() =>
            this.translationsTick.update((tick) => tick + 1)
        );

        effect((onCleanup) => {
            if (!this.controller.session()?.recording?.active) {
                return;
            }
            this.recordingTick.set(Date.now());
            const intervalId = window.setInterval(
                () => this.recordingTick.set(Date.now()),
                1000
            );
            onCleanup(() => window.clearInterval(intervalId));
        });
    }

    setRecordingMessage(
        message: string | null,
        options: { autoDismiss?: boolean } = {}
    ): void {
        this.clearRecordingMessageTimer();
        this.recordingMessage.set(message);

        if (!message || !options.autoDismiss) {
            return;
        }

        this.recordingMessageTimer = window.setTimeout(() => {
            if (this.recordingMessage() === message) {
                this.recordingMessage.set(null);
            }
            this.recordingMessageTimer = null;
        }, RECORDING_MESSAGE_DISMISS_DELAY_MS);
    }

    private async toggleRecording(): Promise<void> {
        if (!this.capabilities().recording || !this.isLive()) {
            return;
        }

        const session = this.controller.session();
        if (session?.recording?.active) {
            const recording = await this.controller.stopRecording();
            if (recording?.targetPath) {
                this.setRecordingMessage(
                    this.translate.instant('EMBEDDED_MPV.PLAYER.SAVED_TO', {
                        path: recording.targetPath,
                    }),
                    { autoDismiss: true }
                );
            } else if (recording?.error) {
                this.setRecordingMessage(recording.error);
            } else {
                this.setRecordingMessage(
                    this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP'
                    )
                );
            }
            return;
        }

        this.setRecordingMessage(null);
        const recording = await this.controller.startRecording(
            this.recordingFolder(),
            this.playback()?.title ?? ''
        );
        if (recording?.active) {
            return;
        }
        if (recording?.error) {
            this.setRecordingMessage(recording.error);
        } else {
            this.setRecordingMessage(
                this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START'
                )
            );
        }
    }

    private recordingElapsed(): number {
        const startedAt = this.controller.session()?.recording?.startedAt;
        this.recordingTick();
        if (!startedAt) {
            return 0;
        }
        const startedAtMs = Date.parse(startedAt);
        if (!Number.isFinite(startedAtMs)) {
            return 0;
        }
        return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    }

    private statusMessage(): string {
        this.translationsTick();
        const session = this.controller.session();
        if (session?.status === 'error') {
            return (
                session.error ??
                this.translate.instant('EMBEDDED_MPV.PLAYER.PLAYBACK_FAILED')
            );
        }
        const support = this.controller.support();
        if (!support) {
            return this.translate.instant(
                'EMBEDDED_MPV.PLAYER.CHECKING_SUPPORT'
            );
        }
        if (!support.supported) {
            return (
                support.reason ??
                this.translate.instant('EMBEDDED_MPV.PLAYER.NOT_AVAILABLE')
            );
        }
        if (!session || session.status === 'loading') {
            return this.translate.instant(
                'EMBEDDED_MPV.PLAYER.LOADING_STREAM'
            );
        }
        return '';
    }

    private mapStatus(
        sessionStatus: string | undefined,
        supported: boolean,
        support: ReturnType<EmbeddedMpvSessionController['support']>
    ): PlayerStatus {
        if (sessionStatus === 'error') {
            return 'error';
        }
        if (
            !support ||
            sessionStatus === 'loading' ||
            (!sessionStatus && supported)
        ) {
            return 'loading';
        }
        switch (sessionStatus) {
            case 'playing':
                return 'playing';
            case 'paused':
                return 'paused';
            case 'ended':
            case 'closed':
                return 'ended';
            default:
                return 'idle';
        }
    }

    private clearRecordingMessageTimer(): void {
        if (this.recordingMessageTimer === null) {
            return;
        }
        window.clearTimeout(this.recordingMessageTimer);
        this.recordingMessageTimer = null;
    }
}
