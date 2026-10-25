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
                (code) => {
                    const p = latest.current.player;
                    if (code === 415) p?.resume();
                    if (code === 19) p?.pause();
                    if (code === 413) latest.current.stop();
                    if (code === 412) p?.seek(-10);
                    if (code === 417) p?.seek(10);
                }
            ),
        []
    );
}
