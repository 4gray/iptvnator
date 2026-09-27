import type { CollectionContentType } from '@iptvnator/portal/shared/util';
import type { DashboardRemainingLabel } from './dashboard-playback.utils';
import type { DashboardHeroSlideKind } from './dashboard-hero-slides.utils';

/** A hero call to action: a router link, never an in-place side effect. */
export interface DashboardHeroAction {
    readonly labelKey: string;
    readonly icon: string;
    readonly link: string[];
    readonly state?: Record<string, unknown>;
    /** Appended as "· 22m left" on a resume action. */
    readonly remainingLabel?: DashboardRemainingLabel | null;
    readonly testId: string;
}

/** One rotation slide of the cinematic dashboard hero. */
export interface DashboardHeroSlide extends DashboardHeroArtwork {
    /** Stable across data refreshes: the active slide is tracked by it. */
    readonly id: string;
    readonly kind: DashboardHeroSlideKind;
    readonly contentType: CollectionContentType;
    readonly title: string;
    /** "Movie" / "Series" / "Live" */
    readonly typeLabelKey: string;
    /** Why the slide is here: "Continue watching", "Favourite channel"… */
    readonly reasonLabelKey: string;
    readonly episodeBadge: string | null;
    /** TMDB vote average ("8.1"), patched in async when available */
    readonly rating: string | null;
    /** Up to two TMDB genre names, patched in async when available */
    readonly genres: readonly string[];
    readonly year: number | null;
    /** Source name (playlist label), never a raw URL or credentials */
    readonly source: string;
    /** Live: programme on air now, its guide category and "HH:mm – HH:mm" */
    readonly programmeTitle: string | null;
    readonly category: string | null;
    readonly timeRange: string | null;
    /** TMDB overview for titles, guide synopsis for live programmes */
    readonly description: string | null;
    /** 0-100: watched share, or elapsed share of the live programme */
    readonly progress: number | null;
    /** Title-derived hue for the live slide's glow (0-359) */
    readonly accentHue: number;
    readonly primaryAction: DashboardHeroAction;
    readonly secondaryAction: DashboardHeroAction | null;
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

/** Stable hue for a title, shared by every generated fallback surface. */
export function dashboardHeroHue(text: string): number {
    return calculateHue(text || 'placeholder');
}

function calculateHue(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    return Math.abs(hash) % 360;
}
