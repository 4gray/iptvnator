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
    /** Owner the current header scope was configured for. */
    private headerScopeOwner: string | null = null;
    private activeOwnership: WebPlayerApplicationOwnership | null = null;

    constructor(
        private readonly streamHeaders: ElectronStreamHeadersService,
        private readonly recoverySession: PlaybackRecoverySession,
        /**
         * Scoped-override owner of this view; null shares the default one
         * every single-player surface uses.
         */
        private readonly headerOwner: () => string | null = () => null
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
        const owner = this.headerOwner();
        if (owner !== this.headerScopeOwner) {
            // The view moved to another owner: release what the old one holds.
            this.clearHeaderScope();
        }
        const headerSync =
            owner === null
                ? this.streamHeaders.apply(playback)
                : this.streamHeaders.apply(playback, owner);
        this.headerScopeStreamUrl = playback.streamUrl;
        this.headerScopeOwner = owner;
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
        this.clearHeaderScope();
    }

    private clearHeaderScope(): void {
        if (this.headerScopeOwner === null) {
            this.streamHeaders.clear(this.headerScopeStreamUrl);
        } else {
            this.streamHeaders.clear(
                this.headerScopeStreamUrl,
                this.headerScopeOwner
            );
        }
        this.headerScopeStreamUrl = null;
        this.headerScopeOwner = null;
    }

    destroy(): void {
        this.recoverySession.endPlayback();
        this.release();
    }
}
