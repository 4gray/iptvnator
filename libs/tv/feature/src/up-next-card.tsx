import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'preact/hooks';
import type { RefObject } from 'preact';
import { AutoplayStreak } from '@iptvnator/shared/interfaces';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import {
    episodeCode,
    isBackKey,
    upNextCard,
    upNextCountdownLabel,
    upNextDismissKey,
    upNextRingShare,
    UpNextCollapseBudget,
    autoplayNextReady,
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
 * it for the rest of this episode, after a while it shrinks to a pill, and
 * with `seriesAutoplay` on the next episode plays when this one ends
 * (dismissed, collapsed, or with `playerUpNextCard` off).
 */
export function useUpNext(
    tv: TvModel,
    video: RefObject<HTMLVideoElement>,
    vod: VodSequence,
    hidden: boolean,
    revealControls: () => void,
    navigationPending = false
): { card: Card | undefined; collapsed: boolean; play: () => void } {
    const [, setTick] = useState(0);
    const [dismissed, setDismissed] = useState<string>();
    const [collapsedKey, setCollapsedKey] = useState<string>();
    const element = video.current;
    const current = tv.fullscreen ? tv.playing : undefined;
    const currentId = current?.id;
    const budget = useMemo(() => new UpNextCollapseBudget(), [currentId]);
    useLayoutEffect(() => {
        setDismissed(undefined);
        setCollapsedKey(undefined);
    }, [currentId]);
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
        enabled: tv.data.playerUpNextCard !== false,
        nextProgress: next ? tv.data.positions[next.id] : undefined,
    });
    const collapsed = !!key && key === collapsedKey;
    const replayPending = tv.replayPending;
    const latest = useRef({
        replayPending,
        navigationPending,
        card,
        vod,
        key,
        autoplay,
        current,
        revealControls,
    });
    latest.current = {
        replayPending,
        navigationPending,
        card,
        vod,
        key,
        autoplay,
        current,
        revealControls,
    };
    // The episode autoplay last advanced from, so it starts the next one once.
    const advancedFrom = useRef<string>();
    const automatic = useRef<AbortController>();
    const advancedTo = useRef<string>();
    const advance = () => {
        if (
            document.hidden ||
            latest.current.replayPending ||
            latest.current.navigationPending
        )
            return;
        const {
            vod: sequence,
            autoplay: on,
            current: playing,
        } = latest.current;
        if (
            !autoplayNextReady({
                ended: !!video.current?.ended,
                autoplay: on,
                currentId: playing?.id,
                hasNext: !!sequence.next,
                activating: sequence.activating,
                advancedFrom: advancedFrom.current,
            }) ||
            !tvAutoplayStreak.beginAutoplay()
        )
            return;
        advancedFrom.current = playing?.id;
        const nextId = sequence.next?.id;
        advancedTo.current = nextId;
        const controller = new AbortController();
        automatic.current = controller;
        let claimed = true;
        const releaseClaim = () => {
            if (!claimed) return;
            claimed = false;
            if (latest.current.current?.id !== nextId)
                tvAutoplayStreak.cancelAutoplay();
        };
        controller.signal.addEventListener('abort', releaseClaim, {
            once: true,
        });
        void sequence
            .playNext(controller.signal)
            .then((started) => {
                if (!started) releaseClaim();
                else claimed = false;
            }, releaseClaim)
            .finally(() => {
                controller.signal.removeEventListener('abort', releaseClaim);
                if (automatic.current === controller)
                    automatic.current = undefined;
            });
    };

    // The next episode can finish loading after this one ended (resuming
    // near the end, a slow portal); autoplay then, not only on `ended`.
    const isEnded = !!element?.ended;
    useEffect(() => {
        if (replayPending) {
            automatic.current?.abort();
            advancedFrom.current = current?.id;
        } else if (navigationPending) {
            automatic.current?.abort();
            advancedFrom.current = undefined;
        } else if (isEnded) {
            advance();
        } else {
            if (current?.id !== advancedTo.current) automatic.current?.abort();
            advancedFrom.current = undefined;
        }
    }, [
        isEnded,
        next?.id,
        vod.activating,
        replayPending,
        navigationPending,
        current?.id,
    ]);

    // Re-render as playback moves so the card appears and counts down.
    useEffect(() => {
        if (!element) return;
        const tick = () => {
            if (
                !element.ended &&
                latest.current.current?.id !== advancedTo.current
            )
                automatic.current?.abort();
            setTick((n) => n + 1);
        };
        const ended = () => {
            tick();
            advance();
        };
        const visibility = () => {
            if (document.hidden) {
                automatic.current?.abort();
                advancedFrom.current = undefined;
            } else {
                tick();
                advance();
            }
        };
        document.addEventListener('visibilitychange', visibility);
        element.addEventListener('timeupdate', tick);
        element.addEventListener('seeking', tick);
        element.addEventListener('ended', ended);
        return () => {
            automatic.current?.abort();
            document.removeEventListener('visibilitychange', visibility);
            element.removeEventListener('timeupdate', tick);
            element.removeEventListener('seeking', tick);
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

    // Shrink to a pill once seen, so the card does not cover the credits.
    useEffect(() => {
        if (!visible || !key || collapsed) return;
        const timer = setTimeout(
            () => setCollapsedKey(key),
            budget.start(key, Date.now())
        );
        return () => {
            clearTimeout(timer);
            budget.stop(Date.now());
        };
    }, [visible, key, collapsed]);

    // Window capture runs before the document listeners that reveal dormant
    // controls (and swallow that first OK) or leave the player on Back.
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            const state = latest.current;
            if (!state.card) return;
            const back = isBackKey(event);
            const focused = focusKey() === FOCUS_KEY;
            const ok = event.key === 'Enter' && focused;
            if (!back && !ok) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (back) {
                setDismissed(state.key);
                if (focused) {
                    state.revealControls();
                    restoreFocus('player-toggle');
                }
            } else void state.vod.playNext();
        };
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    }, []);

    return { card, collapsed, play: () => void vod.playNext() };
}

export function UpNextCard({
    card,
    collapsed,
    play,
}: {
    card: Card;
    collapsed: boolean;
    play: () => void;
}) {
    const share = upNextRingShare(card);
    const code = episodeCode(card.next);
    const still = card.next.episodeStill;
    const [failedStill, setFailedStill] = useState<string>();
    return (
        <button
            class={`tv-up-next${collapsed ? ' tv-up-next--collapsed' : ''}`}
            data-focus={FOCUS_KEY}
            onClick={play}
            aria-label={`Up next: ${code}${card.next.title ? ` – ${card.next.title}` : ''}`}
        >
            {collapsed ? null : (
                <span class="tv-up-next__thumb" aria-hidden="true">
                    {still && still !== failedStill ? (
                        <img
                            key={still}
                            src={still}
                            alt=""
                            onError={() => setFailedStill(still)}
                        />
                    ) : (
                        <span class="tv-up-next__placeholder">{code}</span>
                    )}
                    {card.progressPercent !== null ? (
                        <span class="tv-up-next__progress">
                            <span
                                style={{ width: `${card.progressPercent}%` }}
                            />
                        </span>
                    ) : null}
                </span>
            )}
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
                {collapsed ? null : (
                    <>
                        <span class="tv-up-next__title">{card.next.title}</span>
                        <span class="tv-up-next__hint">
                            OK to play · Back to hide
                        </span>
                    </>
                )}
            </span>
        </button>
    );
}
