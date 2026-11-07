import { useEffect, useRef } from 'preact/hooks';
import type { NativePlayer } from '@iptvnator/tv/data-access';
import { installRemote } from '@iptvnator/tv/ui';

export function useTvRemote(state: {
    back: () => void;
    stop: () => void;
    fullscreen: boolean;
    player: NativePlayer | undefined;
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
                    if (action === 'play') p?.resume();
                    if (action === 'pause') p?.pause();
                    if (action === 'toggle') p?.toggle();
                    if (action === 'stop') latest.current.stop();
                    if (action === 'rewind') p?.seek(-10);
                    if (action === 'forward') p?.seek(10);
                }
            ),
        []
    );
}
