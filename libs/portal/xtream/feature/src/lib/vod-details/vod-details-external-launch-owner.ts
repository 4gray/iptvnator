import { Signal, computed, signal } from '@angular/core';
import type { PlayerContentInfo } from '@iptvnator/shared/interfaces';

interface RouteScopedExternalLaunch {
    readonly routePlaylistId: string;
    readonly routeContentId: number;
    readonly content: PlayerContentInfo;
}

export interface ExternalLaunchRouteIdentity {
    readonly playlistId: string;
    readonly contentId: number;
}

export interface ExternalLaunchOwner {
    readonly current: Signal<PlayerContentInfo | null>;
    /** Exact last destination retained for close-before-replacement. */
    readonly retained: Signal<PlayerContentInfo | null>;
    captureRoute(): ExternalLaunchRouteIdentity | null;
    ownsRoute(identity: ExternalLaunchRouteIdentity | null): boolean;
    set(content: PlayerContentInfo | null | undefined): void;
    clear(): void;
}

/** Retains an external destination only while its initiating VOD route owns it. */
export function createExternalLaunchOwner(
    routePlaylistId: () => string | undefined,
    routeContentId: () => number | undefined
): ExternalLaunchOwner {
    const launch = signal<RouteScopedExternalLaunch | null>(null);
    const captureRoute = (): ExternalLaunchRouteIdentity | null => {
        const playlistId = routePlaylistId();
        const contentId = routeContentId();
        return playlistId &&
            contentId !== undefined &&
            Number.isSafeInteger(contentId) &&
            contentId > 0
            ? { playlistId, contentId }
            : null;
    };
    return {
        current: computed(() => {
            const value = launch();
            return value &&
                value.routePlaylistId === routePlaylistId() &&
                value.routeContentId === routeContentId()
                ? value.content
                : null;
        }),
        retained: computed(() => launch()?.content ?? null),
        captureRoute,
        ownsRoute: (identity) => {
            const current = captureRoute();
            return (
                !!identity &&
                current?.playlistId === identity.playlistId &&
                current.contentId === identity.contentId
            );
        },
        set: (content) => {
            const route = captureRoute();
            launch.set(
                content && route
                    ? {
                          routePlaylistId: route.playlistId,
                          routeContentId: route.contentId,
                          content,
                      }
                    : null
            );
        },
        clear: () => launch.set(null),
    };
}

/** Runs a Play/Resume only while its initiating VOD route still owns it. */
export async function startRouteOwnedPlayback(
    owner: ExternalLaunchOwner,
    start: (isCurrent: () => boolean) => Promise<boolean>
): Promise<boolean> {
    const route = owner.captureRoute();
    if (!route) return false;
    try {
        return await start(() => owner.ownsRoute(route));
    } catch {
        return false;
    }
}
