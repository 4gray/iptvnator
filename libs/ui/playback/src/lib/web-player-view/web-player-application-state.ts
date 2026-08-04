import { computed, type Signal } from '@angular/core';
import type {
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    resolveWebPlayerIsLive,
    resolveWebPlayerPlayback,
} from './web-player-playback-state';

export type WebPlayerApplicationToken = symbol;

export function createWebPlayerApplicationState(sources: {
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly streamUrl: Signal<string>;
    readonly title: Signal<string>;
    readonly startTime: Signal<number>;
    readonly selectedPlayer: Signal<VideoPlayer>;
    readonly reloadToken: Signal<number>;
}): {
    readonly playback: Signal<ResolvedPortalPlayback>;
    readonly isLive: Signal<boolean>;
    readonly token: Signal<WebPlayerApplicationToken>;
} {
    const playback = computed(() => {
        const explicit = sources.playback();
        return (
            explicit ??
            resolveWebPlayerPlayback({
                playback: null,
                streamUrl: sources.streamUrl(),
                title: sources.title(),
                startTime: sources.startTime(),
            })
        );
    });
    const isLive = computed(() => {
        const explicit = sources.playback();
        return explicit ? resolveWebPlayerIsLive(explicit) : true;
    });
    const token = computed<WebPlayerApplicationToken>(() => {
        if (sources.playback() === null) {
            void sources.streamUrl();
            void sources.startTime();
        }
        void isLive();
        void sources.selectedPlayer();
        void sources.reloadToken();
        return Symbol();
    });
    return { playback, isLive, token };
}
