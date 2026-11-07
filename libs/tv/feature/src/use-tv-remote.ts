import { useEffect, useRef } from 'preact/hooks';
import type { NativePlayer } from '@iptvnator/tv/data-access';
import { installRemote } from '@iptvnator/tv/ui';

export function useTvRemote(state: {
    back: () => void;
    stop: () => void;
    fullscreen: boolean;
    player: NativePlayer | undefined;
    resume: () => void;
}) {
    const latest = useRef(state);
    latest.current = state;
    useEffect(
        () =>
            installRemote(
                () => latest.current.back(),
                () => latest.current.fullscreen,
                (action) => {
                    const p = latest.current.player;
                    if (
                        action === 'play' ||
                        (action === 'toggle' && p?.video.paused)
                    )
                        latest.current.resume();
                    else if (action === 'pause' || action === 'toggle')
                        p?.pause();
                    if (action === 'stop') latest.current.stop();
                    if (action === 'rewind') p?.seek(-10);
                    if (action === 'forward') p?.seek(10);
                }
            ),
        []
    );
}
