import {
    UP_NEXT_COLLAPSE_DELAY_MS,
    upNextLeadSeconds,
} from '@iptvnator/shared/interfaces';
import type { Media, Progress } from './index';

/**
 * The TV "Up next" card, decided the same way as the desktop and web card:
 * the shared `upNextLeadSeconds` sets when it appears (a supplied credits
 * start, else the adaptive lead), and the card names the next episode with
 * its still, title and a countdown to the end of this one.
 */
export interface UpNextInput {
    current: Media | undefined;
    next: Media | undefined;
    durationSeconds: number;
    positionSeconds: number;
    ended: boolean;
    /** The viewer pressed Back on this card for this episode. */
    dismissed: boolean;
    /** Another surface (a live overlay panel, an error) covers the player. */
    hidden: boolean;
    /** `seriesAutoplay`: the countdown only shows when the end plays on. */
    autoplay: boolean;
    /**
     * `playerUpNextCard`, same name and default as desktop: false hides the
     * card only; autoplay at the end still follows `seriesAutoplay`.
     */
    enabled?: boolean;
    /** Credits start from a metadata source (TheIntroDB, #2239). */
    creditsStartSeconds?: number | null;
    /** Saved progress of the next episode, for the partly-watched bar. */
    nextProgress?: Progress;
}

export interface UpNextCard {
    next: Media;
    remainingSeconds: number;
    leadSeconds: number;
    countdown: boolean;
    /** 0–100 when the next episode was partly watched, else null. */
    progressPercent: number | null;
}

export function upNextCard(input: UpNextInput): UpNextCard | undefined {
    const { current, next } = input;
    if (
        current?.kind !== 'episode' ||
        !next ||
        input.enabled === false ||
        input.ended ||
        input.dismissed ||
        input.hidden
    )
        return;
    const lead = upNextLeadSeconds({
        durationSeconds: input.durationSeconds,
        creditsStartSeconds: input.creditsStartSeconds,
    });
    if (lead === null) return;
    const remaining = Math.max(
        0,
        input.durationSeconds - Math.max(0, input.positionSeconds || 0)
    );
    if (remaining > lead) return;
    return {
        next,
        remainingSeconds: remaining,
        leadSeconds: lead,
        countdown: input.autoplay,
        progressPercent: progressPercent(input.nextProgress),
    };
}

/** Whole seconds under a minute, otherwise whole minutes, like desktop. */
export function upNextCountdownLabel(remainingSeconds: number): string {
    const seconds = Math.max(0, Math.ceil(remainingSeconds));
    return seconds < 60
        ? `in ${seconds} s`
        : `in ${Math.ceil(seconds / 60)} min`;
}

/** Share of the lead still to run, 1 → 0, for the countdown ring. */
export function upNextRingShare(card: UpNextCard): number {
    return card.leadSeconds > 0
        ? Math.min(1, Math.max(0, card.remainingSeconds / card.leadSeconds))
        : 0;
}

/**
 * Time the full card has left before it shrinks to a pill, like desktop:
 * the delay only runs while the card is on screen (a panel covering it
 * pauses the count rather than resetting it), and a new card starts afresh.
 */
export class UpNextCollapseBudget {
    private key: string | undefined;
    private remainingMs = UP_NEXT_COLLAPSE_DELAY_MS;
    private startedAt: number | null = null;

    /** The card is on screen; returns the milliseconds until it collapses. */
    start(key: string, now: number): number {
        if (key !== this.key) {
            this.key = key;
            this.remainingMs = UP_NEXT_COLLAPSE_DELAY_MS;
        }
        this.startedAt = now;
        return this.remainingMs;
    }

    /** The card left the screen; keep the time still owed. */
    stop(now: number): void {
        if (this.startedAt === null) return;
        this.remainingMs = Math.max(
            0,
            this.remainingMs - (now - this.startedAt)
        );
        this.startedAt = null;
    }
}

/**
 * Whether `seriesAutoplay` should start the next episode now: this one has
 * ended, the next one is known (it may arrive after the end), nothing is
 * already starting, and autoplay has not advanced from this episode yet.
 */
export function autoplayNextReady(state: {
    ended: boolean;
    autoplay: boolean;
    currentId: string | undefined;
    hasNext: boolean;
    activating: boolean;
    advancedFrom: string | undefined;
}): boolean {
    return (
        state.ended &&
        state.autoplay &&
        !!state.currentId &&
        state.hasNext &&
        !state.activating &&
        state.advancedFrom !== state.currentId
    );
}

/** A dismissal lasts for this episode and the next one it pointed to. */
export function upNextDismissKey(current: Media, next: Media): string {
    return JSON.stringify([current.id, next.id]);
}

function progressPercent(progress: Progress | undefined): number | null {
    if (
        !progress ||
        progress.reset ||
        progress.watched ||
        !(progress.duration > 0) ||
        !(progress.seconds > 0)
    )
        return null;
    return Math.min(
        100,
        Math.round((progress.seconds / progress.duration) * 100)
    );
}
