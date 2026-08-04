import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import type { VideoPlayerOptions } from '../vjs-player/vjs-player.types';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';
import {
    type PlaybackBinding,
    PlaybackRecoverySession,
} from './playback-recovery-session';
import type { WebPlayerApplicationToken } from './web-player-application-state';
import {
    createVideoJsOptions,
    createWebPlayerChannel,
} from './web-player-playback-state';

export interface WebPlayerApplicationHandoff {
    readonly channel: ReturnType<typeof createWebPlayerChannel>;
    readonly vjsOptions: VideoPlayerOptions;
}

interface WebPlayerApplicationOwnership {
    readonly binding: PlaybackBinding;
    readonly token: WebPlayerApplicationToken;
}

export class WebPlayerApplicationHandoffCoordinator {
    private headerScopeStreamUrl: string | null = null;
    private activeOwnership: WebPlayerApplicationOwnership | null = null;

    constructor(
        private readonly streamHeaders: ElectronStreamHeadersService,
        private readonly recoverySession: PlaybackRecoverySession
    ) {}

    apply(
        playback: ResolvedPortalPlayback,
        isLive: boolean,
        reloadToken: number,
        binding: PlaybackBinding,
        token: WebPlayerApplicationToken,
        currentToken: () => WebPlayerApplicationToken,
        accept: (handoff: WebPlayerApplicationHandoff) => void
    ): void {
        this.activeOwnership = Object.freeze({ binding, token });
        const headerSync = this.streamHeaders.apply(playback);
        this.headerScopeStreamUrl = playback.streamUrl;
        const acceptSource = (): void => {
            const options = createVideoJsOptions({
                streamUrl: playback.streamUrl,
                isLive,
                reloadToken,
            });
            accept({
                channel: createWebPlayerChannel(playback),
                vjsOptions: {
                    ...options,
                    sources: options.sources.map((source) => ({ ...source })),
                },
            });
        };
        if (!headerSync) {
            acceptSource();
            return;
        }
        const handOff = (): void => {
            if (this.ownsCurrentApplication(binding, token, currentToken)) {
                acceptSource();
            }
        };
        void headerSync.then(
            (stillCurrent) => {
                if (stillCurrent) {
                    handOff();
                } else if (
                    this.ownsCurrentApplication(binding, token, currentToken)
                ) {
                    this.recoverySession.settle(binding);
                }
            },
            () => {
                if (this.ownsCurrentApplication(binding, token, currentToken)) {
                    this.recoverySession.settle(binding);
                }
            }
        );
    }

    owns(binding: PlaybackBinding, token: WebPlayerApplicationToken): boolean {
        if (!this.recoverySession.accepts(binding)) {
            return false;
        }
        const active = this.activeOwnership;
        return active?.binding === binding && active.token === token;
    }

    invalidate(): void {
        this.activeOwnership = null;
    }

    private ownsCurrentApplication(
        binding: PlaybackBinding,
        token: WebPlayerApplicationToken,
        currentToken: () => WebPlayerApplicationToken
    ): boolean {
        return this.owns(binding, token) && currentToken() === token;
    }

    release(): void {
        this.invalidate();
        this.streamHeaders.clear(this.headerScopeStreamUrl);
        this.headerScopeStreamUrl = null;
    }

    destroy(): void {
        this.recoverySession.endPlayback();
        this.release();
    }
}
