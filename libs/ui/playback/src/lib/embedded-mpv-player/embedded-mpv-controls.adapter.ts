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
import {
    EmbeddedMpvControlsRecording,
    resolveRecordingFeedback,
} from './embedded-mpv-controls-recording';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

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
    private readonly recordingControls = new EmbeddedMpvControlsRecording(
        this.controller
    );
    private readonly recordingActive = computed(
        () => this.controller.session()?.recording?.active === true
    );
    private readonly activeSessionId = computed(
        () => this.controller.session()?.id ?? null
    );
    private readonly playbackIdentity = computed(() => {
        const playback = this.configuredContext()?.playback();
        return playback ? JSON.stringify(playback) : null;
    });
    private readonly recordingTick = signal(Date.now());

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
                message: resolveRecordingFeedback(
                    this.recordingControls.feedback(),
                    this.translate
                ),
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
            if (!this.recordingActive()) {
                return;
            }

            untracked(() => this.recordingTick.set(Date.now()));
            const intervalId = window.setInterval(
                () => this.recordingTick.set(Date.now()),
                1000
            );
            onCleanup(() => window.clearInterval(intervalId));
        });

        effect(() => {
            const playbackIdentity = this.playbackIdentity();
            const sessionId = this.activeSessionId();
            untracked(() =>
                this.recordingControls.syncOwner(playbackIdentity, sessionId)
            );
        });

        effect(() => {
            const session = this.controller.session();
            const playbackIdentity = this.playbackIdentity();
            untracked(() =>
                this.recordingControls.reconcile(session, playbackIdentity)
            );
        });

        this.destroyRef.onDestroy(() => this.recordingControls.destroy());
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

    private toggleRecording(): void {
        const context = this.configuredContext();
        const support = this.controller.support();
        const session = this.controller.session();
        const playbackIdentity = this.playbackIdentity();
        if (
            !context ||
            !session ||
            !playbackIdentity ||
            !support?.supported ||
            support.capabilities?.recording !== true ||
            !this.isLivePlayback(context.playback()) ||
            session?.status === 'error'
        ) {
            return;
        }

        this.recordingControls.toggle({
            folder: context.recordingFolder(),
            playback: context.playback(),
            playbackIdentity,
            session,
        });
    }
}
