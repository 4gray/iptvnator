import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { AutoplayStreak } from '@iptvnator/shared/interfaces';
import { restoreFocus } from '@iptvnator/tv/ui';
import {
    episodeCode,
    isBackKey,
    upNextCard,
    upNextCountdownLabel,
    upNextDismissKey,
    upNextRingShare,
    type UpNextCard as Card,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import type { VodSequence } from './use-vod-sequence';

const FOCUS_KEY = 'player-up-next';

/**
 * Episodes autoplayed in a row on this TV (#2245), shared with desktop's
 * rules: autoplay claims each one, any other start resets the run.
 */
export const tvAutoplayStreak = new AutoplayStreak();

/**
 * Up next for the fullscreen TV player, matching the desktop and web card:
 * it appears at the shared lead, OK plays the next episode now, Back hides
 * it for the rest of this episode, and with `seriesAutoplay` on the next
 * episode plays when this one ends (dismissed or not).
 */
export function useUpNext(
    tv: TvModel,
    video: RefObject<HTMLVideoElement>,
    vod: VodSequence,
    hidden: boolean
): { card: Card | undefined; play: () => void } {
    const [, setTick] = useState(0);
    const [dismissed, setDismissed] = useState<string>();
    const element = video.current;
    const current = tv.fullscreen ? tv.playing : undefined;
    const next = vod.next;
    const key = current && next ? upNextDismissKey(current, next) : undefined;
    const autoplay = tv.data.seriesAutoplay !== false;
    const card = upNextCard({
        current,
        next,
        durationSeconds: element?.duration ?? NaN,
        positionSeconds: element?.currentTime ?? 0,
        ended: !!element?.ended,
        dismissed: !!key && key === dismissed,
        hidden: hidden || !!tv.error || vod.activating,
        autoplay,
        nextProgress: next ? tv.data.positions[next.id] : undefined,
    });
    const latest = useRef({ card, vod, key, autoplay });
    latest.current = { card, vod, key, autoplay };

    // Re-render as playback moves so the card appears and counts down.
    useEffect(() => {
        if (!element) return;
        const tick = () => setTick((n) => n + 1);
        const ended = () => {
            tick();
            const { vod: sequence, autoplay: on } = latest.current;
            if (
                on &&
                sequence.next &&
                !sequence.activating &&
                tvAutoplayStreak.beginAutoplay()
            )
                void sequence.playNext();
        };
        element.addEventListener('timeupdate', tick);
        element.addEventListener('ended', ended);
        return () => {
            element.removeEventListener('timeupdate', tick);
            element.removeEventListener('ended', ended);
        };
    }, [element]);

    // Every start reports to the autoplay run; one the viewer chose resets it.
    const playingId = tv.playing?.id;
    useEffect(() => {
        if (playingId) tvAutoplayStreak.playbackStarted();
    }, [playingId]);

    // The card takes focus when it appears, so OK plays the next episode.
    const visible = !!card;
    useLayoutEffect(() => {
        if (!visible) return;
        let owns = true;
        restoreFocus(FOCUS_KEY, '', undefined, () => owns);
        return () => {
            owns = false;
        };
    }, [visible, key]);

    // Window capture runs before the document listeners that reveal dormant
    // controls (and swallow that first OK) or leave the player on Back.
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            const state = latest.current;
            if (!state.card) return;
            const back = isBackKey(event);
            const ok =
                event.key === 'Enter' &&
                document.activeElement?.getAttribute('data-focus') ===
                    FOCUS_KEY;
            if (!back && !ok) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (back) setDismissed(state.key);
            else void state.vod.playNext();
        };
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    }, []);

    return { card, play: () => void vod.playNext() };
}

export function UpNextCard({ card, play }: { card: Card; play: () => void }) {
    const share = upNextRingShare(card);
    const code = episodeCode(card.next);
    return (
        <button
            class="tv-up-next"
            data-focus={FOCUS_KEY}
            onClick={play}
            aria-label={`Up next: ${code}${card.next.title ? ` – ${card.next.title}` : ''}`}
        >
            <span class="tv-up-next__thumb" aria-hidden="true">
                {card.next.episodeStill ? (
                    <img src={card.next.episodeStill} alt="" />
                ) : (
                    <span class="tv-up-next__placeholder">{code}</span>
                )}
                {card.progressPercent !== null ? (
                    <span class="tv-up-next__progress">
                        <span style={{ width: `${card.progressPercent}%` }} />
                    </span>
                ) : null}
            </span>
            <span class="tv-up-next__meta">
                <span class="tv-up-next__eyebrow">
                    Up next · {code}
                    {card.countdown ? (
                        <>
                            {' '}
                            · {upNextCountdownLabel(card.remainingSeconds)}
                            <svg
                                class="tv-up-next__ring"
                                viewBox="0 0 20 20"
                                aria-hidden="true"
                            >
                                <circle
                                    class="tv-up-next__ring-track"
                                    cx="10"
                                    cy="10"
                                    r="8"
                                    pathLength="100"
                                    fill="none"
                                    stroke-width="2.5"
                                />
                                <circle
                                    class="tv-up-next__ring-fill"
                                    cx="10"
                                    cy="10"
                                    r="8"
                                    pathLength="100"
                                    fill="none"
                                    stroke-width="2.5"
                                    stroke-dashoffset={100 - share * 100}
                                />
                            </svg>
                        </>
                    ) : null}
                </span>
                <span class="tv-up-next__title">{card.next.title}</span>
                <span class="tv-up-next__hint">OK to play · Back to hide</span>
            </span>
        </button>
    );
}
