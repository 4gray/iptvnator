import { isBackKey } from '@iptvnator/tv/util';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';
import type { useLiveBrowse } from './use-live-browse';

/** Playlist browsing reveals the existing preview without restarting the channel. */
export function usePlayerPlaylist(
    tv: TvModel,
    browse: ReturnType<typeof useLiveBrowse>
) {
    const returning = useRef(false);
    const latest = useRef(tv);
    latest.current = tv;
    useLayoutEffect(() => {
        if (tv.route.view !== 'live' || !tv.playing || tv.fullscreen)
            returning.current = false;
    }, [tv.route.view, tv.playing?.id, tv.fullscreen]);
    useEffect(() => {
        const back = (event: KeyboardEvent) => {
            const current = latest.current;
            if (
                !returning.current ||
                current.fullscreen ||
                !current.playing ||
                document.querySelector('[data-tv-modal]')
            )
                return;
            if (!isBackKey(event)) return;
            if (
                event.key === 'Backspace' &&
                (event.target as HTMLElement).matches('input,textarea')
            )
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            returning.current = false;
            current.setFullscreen(true);
            restoreFocus('player-playlist', 'player-toggle');
        };
        document.addEventListener('keydown', back, true);
        return () => document.removeEventListener('keydown', back, true);
    }, []);
    return {
        open: () => {
            if (tv.playing?.kind !== 'live') return;
            returning.current = true;
            browse.showPlaying();
            tv.setFullscreen(false);
            restoreFocus(tv.playing.id, 'live-categories');
        },
    };
}
