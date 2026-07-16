import {
    DestroyRef,
    Injectable,
    Signal,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { merge } from 'rxjs';
import {
    DEFAULT_ASPECT_PRESETS,
    DEFAULT_PLAYER_CAPABILITIES,
    DEFAULT_SPEED_PRESETS,
    createEmptyControlsState,
} from '../player-controls/player-controls-defaults';
import {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerStatus,
} from '../player-controls/player-controls.model';
import { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import {
    audioTrackLabel,
    readStoredVolume,
    subtitleTrackLabel,
} from './embedded-mpv-format.utils';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const RECORDING_MESSAGE_DISMISS_DELAY_MS = 5000;

export interface EmbeddedMpvControlsContext {
    readonly playback: Signal<ResolvedPortalPlayback>;
    readonly seriesNavigation: Signal<SeriesPlaybackNavigation | null>;
    readonly recordingFolder: Signal<string>;
}

interface MappedPlayerStatus {
    status: PlayerStatus;
    statusMessage: string;
}

@Injectable()
export class EmbeddedMpvControlsAdapter implements PlayerController {
    private readonly controller = inject(EmbeddedMpvSessionController);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly translationsTick = toSignal(
        merge(
            this.translate.onLangChange,
            this.translate.onTranslationChange,
            this.translate.onDefaultLangChange
        ),
        { initialValue: null }
    );

    private readonly configuredContext =
        signal<EmbeddedMpvControlsContext | null>(null);
    private readonly recordingTick = signal(Date.now());
    private readonly recordingMessage = signal<string | null>(null);
    private recordingMessageTimer: number | null = null;
    private destroyed = false;

    readonly capabilities = computed<PlayerControlsCapabilities>(() => {
        const context = this.configuredContext();
        if (!context) {
            return DEFAULT_PLAYER_CAPABILITIES;
        }

        const isLive = this.isLivePlayback(context.playback());
        const optionalCapabilities = this.controller.support()?.capabilities;

        return {
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: !isLive,
            volume: true,
            audioTracks: true,
            subtitles: optionalCapabilities?.subtitles ?? false,
            playbackSpeed: optionalCapabilities?.playbackSpeed ?? false,
            aspectRatio: optionalCapabilities?.aspectOverride ?? false,
            recording: optionalCapabilities?.recording ?? false,
            fullscreen: true,
            seriesNavigation: !isLive && context.seriesNavigation() !== null,
        };
    });

    readonly state = computed<PlayerControlsState>(() => {
        const context = this.configuredContext();
        if (!context) {
            return createEmptyControlsState();
        }

        this.translationsTick();
        const support = this.controller.support();
        const session = this.controller.session();
        const playback = context.playback();
        const isLive = this.isLivePlayback(playback);
        const durationSeconds = isLive
            ? null
            : (session?.durationSeconds ?? null);
        const seriesNavigation = context.seriesNavigation();
        const hasSeriesNavigation = !isLive && seriesNavigation !== null;
        const mappedStatus = this.mapStatus(support, session);
        const recording = session?.recording;

        return {
            ...mappedStatus,
            stalled: this.controller.stalled(),
            positionSeconds: Math.max(0, session?.positionSeconds ?? 0),
            durationSeconds,
            isLive,
            canSeek: !isLive && (durationSeconds ?? 0) > 0,
            volume: session?.volume ?? readStoredVolume(),
            audioTracks: (session?.audioTracks ?? []).map((track, index) => ({
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
            })),
            subtitleTracks: (session?.subtitleTracks ?? []).map(
                (track, index) => ({
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
                })
            ),
            subtitlesEnabled: (session?.selectedSubtitleTrackId ?? -1) >= 0,
            playbackSpeed: session?.playbackSpeed ?? 1,
            speedPresets: DEFAULT_SPEED_PRESETS,
            aspectRatio: session?.aspectOverride ?? 'no',
            aspectPresets: DEFAULT_ASPECT_PRESETS,
            recording: {
                active: recording?.active === true,
                elapsedSeconds: this.recordingElapsedSeconds(
                    recording?.startedAt
                ),
                message: this.recordingMessage(),
            },
            canPreviousEpisode:
                hasSeriesNavigation && seriesNavigation?.canPrevious === true,
            canNextEpisode:
                hasSeriesNavigation && seriesNavigation?.canNext === true,
        };
    });

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => void this.controller.togglePaused(),
        seekTo: (seconds) => void this.controller.seekTo(seconds),
        seekBy: (deltaSeconds) => void this.controller.seekBy(deltaSeconds),
        setVolume: (value) => void this.controller.applyVolume(value),
        setAudioTrack: (id) => void this.controller.setAudioTrack(id),
        setSubtitleTrack: (id) => void this.controller.setSubtitleTrack(id),
        setPlaybackSpeed: (speed) => void this.controller.setSpeed(speed),
        setAspectRatio: (value) => void this.controller.setAspect(value),
        toggleRecording: () => void this.toggleRecording(),
    };

    constructor() {
        effect((onCleanup) => {
            if (this.controller.session()?.recording?.active !== true) {
                return;
            }

            untracked(() => this.recordingTick.set(Date.now()));
            const intervalId = window.setInterval(
                () => this.recordingTick.set(Date.now()),
                1000
            );
            onCleanup(() => window.clearInterval(intervalId));
        });

        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            this.clearRecordingMessageTimer();
        });
    }

    configure(context: EmbeddedMpvControlsContext): void {
        this.configuredContext.set(context);
    }

    private isLivePlayback(playback: ResolvedPortalPlayback): boolean {
        if (typeof playback.isLive === 'boolean') {
            return playback.isLive;
        }
        return !playback.contentInfo;
    }

    private mapStatus(
        support: EmbeddedMpvSupport | null,
        session: EmbeddedMpvSession | null
    ): MappedPlayerStatus {
        if (!support) {
            return {
                status: 'loading',
                statusMessage: this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.CHECKING_SUPPORT'
                ),
            };
        }

        if (!support.supported) {
            return {
                status: 'idle',
                statusMessage:
                    support.reason ??
                    this.translate.instant('EMBEDDED_MPV.PLAYER.NOT_AVAILABLE'),
            };
        }

        if (!session || session.status === 'loading') {
            return {
                status: 'loading',
                statusMessage: this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.LOADING_STREAM'
                ),
            };
        }

        switch (session.status) {
            case 'playing':
            case 'paused':
            case 'idle':
                return { status: session.status, statusMessage: '' };
            case 'ended':
            case 'closed':
                return { status: 'ended', statusMessage: '' };
            case 'error':
                return {
                    status: 'error',
                    statusMessage:
                        session.error ??
                        this.translate.instant(
                            'EMBEDDED_MPV.PLAYER.PLAYBACK_FAILED'
                        ),
                };
        }
    }

    private recordingElapsedSeconds(startedAt: string | undefined): number {
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

    private async toggleRecording(): Promise<void> {
        const context = this.configuredContext();
        const support = this.controller.support();
        const session = this.controller.session();
        if (
            !context ||
            !support?.supported ||
            support.capabilities?.recording !== true ||
            !this.isLivePlayback(context.playback()) ||
            session?.status === 'error'
        ) {
            return;
        }

        if (session?.recording?.active === true) {
            await this.stopRecording();
            return;
        }

        await this.startRecording(context);
    }

    private async startRecording(
        context: EmbeddedMpvControlsContext
    ): Promise<void> {
        this.setRecordingMessage(null);

        try {
            const recording = await this.controller.startRecording(
                context.recordingFolder(),
                context.playback().title
            );
            if (this.destroyed || recording?.active) {
                return;
            }

            this.setRecordingMessage(
                recording?.error ??
                    this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START'
                    )
            );
        } catch {
            this.setRecordingMessage(
                this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START'
                )
            );
        }
    }

    private async stopRecording(): Promise<void> {
        try {
            const recording = await this.controller.stopRecording();
            if (this.destroyed) {
                return;
            }

            if (recording?.targetPath) {
                this.setRecordingMessage(
                    this.translate.instant('EMBEDDED_MPV.PLAYER.SAVED_TO', {
                        path: recording.targetPath,
                    }),
                    { autoDismiss: true }
                );
                return;
            }

            this.setRecordingMessage(
                recording?.error ??
                    this.translate.instant(
                        'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP'
                    )
            );
        } catch {
            this.setRecordingMessage(
                this.translate.instant(
                    'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP'
                )
            );
        }
    }

    private setRecordingMessage(
        message: string | null,
        options: { autoDismiss?: boolean } = {}
    ): void {
        if (this.destroyed) {
            return;
        }

        this.clearRecordingMessageTimer();
        this.recordingMessage.set(message);

        if (!message || !options.autoDismiss) {
            return;
        }

        const timerId = window.setTimeout(() => {
            if (!this.destroyed && this.recordingMessage() === message) {
                this.recordingMessage.set(null);
            }
            if (this.recordingMessageTimer === timerId) {
                this.recordingMessageTimer = null;
            }
        }, RECORDING_MESSAGE_DISMISS_DELAY_MS);
        this.recordingMessageTimer = timerId;
    }

    private clearRecordingMessageTimer(): void {
        if (this.recordingMessageTimer === null) {
            return;
        }

        window.clearTimeout(this.recordingMessageTimer);
        this.recordingMessageTimer = null;
    }
}
