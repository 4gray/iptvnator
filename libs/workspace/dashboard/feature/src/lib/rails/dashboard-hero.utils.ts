import type { CollectionContentType } from '@iptvnator/portal/shared/util';
import type { DashboardRemainingLabel } from './dashboard-playback.utils';

export interface DashboardHeroModel {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly contentType?: CollectionContentType;
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly icon: string;
    readonly link: string[];
    readonly posterUrl?: string;
    readonly state?: Record<string, unknown>;
    readonly subtitle: string;
    readonly title: string;
    /** 0-100 watched, when a resume position is known. */
    readonly watchProgress?: number | null;
    readonly remainingLabel?: DashboardRemainingLabel | null;
    readonly nowPlayingTitle?: string | null;
    readonly nowPlayingTimeRange?: string | null;
    readonly nowPlayingProgress?: number | null;
}

export type DashboardHeroBackdropSource = 'backdrop' | 'poster' | 'fallback';

export interface DashboardHeroArtworkInput {
    readonly backdropUrl?: string | null;
    readonly posterUrl?: string | null;
    readonly title: string;
}

export interface DashboardHeroArtwork {
    readonly backdropUrl?: string;
    readonly backdropSource: DashboardHeroBackdropSource;
    readonly fallbackBackdropBackground: string;
    readonly fallbackPosterBackground: string;
    readonly hasBackdrop: boolean;
    readonly posterUrl?: string;
}

export function resolveDashboardHeroArtwork(
    item: DashboardHeroArtworkInput,
    failedImages: Record<string, true>
): DashboardHeroArtwork {
    const posterUrl =
        item.posterUrl && !failedImages[item.posterUrl]
            ? item.posterUrl
            : undefined;
    const explicitBackdropUrl =
        item.backdropUrl && !failedImages[item.backdropUrl]
            ? item.backdropUrl
            : undefined;
    const backdropUrl = explicitBackdropUrl ?? posterUrl;
    const backdropSource: DashboardHeroBackdropSource = explicitBackdropUrl
        ? 'backdrop'
        : posterUrl
          ? 'poster'
          : 'fallback';

    return {
        backdropUrl,
        backdropSource,
        fallbackBackdropBackground: buildFallbackBackground(
            item.title,
            50,
            15,
            80,
            5,
            60
        ),
        fallbackPosterBackground: buildFallbackBackground(
            item.title,
            40,
            25,
            50,
            15,
            40
        ),
        hasBackdrop: backdropSource === 'backdrop',
        posterUrl,
    };
}

function buildFallbackBackground(
    title: string,
    saturationA: number,
    lightnessA: number,
    saturationB: number,
    lightnessB: number,
    hueOffset: number
): string {
    const hue = calculateHue(title || 'placeholder');
    const h2 = (hue + hueOffset) % 360;
    return `linear-gradient(135deg, hsl(${hue}, ${saturationA}%, ${lightnessA}%) 0%, hsl(${h2}, ${saturationB}%, ${lightnessB}%) 100%)`;
}

function calculateHue(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    return Math.abs(hash) % 360;
}
