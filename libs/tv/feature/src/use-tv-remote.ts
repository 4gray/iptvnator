import { useEffect, useRef } from 'preact/hooks';
import type { NativePlayer } from '@iptvnator/tv/data-access';
import { installRemote } from '@iptvnator/tv/ui';
import type { Media } from '@iptvnator/tv/util';

export function useTvRemote(state: {
    back: () => void;
    stop: () => void;
    fullscreen: boolean;
    player: NativePlayer | undefined;
    restore: (fallback: string) => void;
    startOver: (item: Media) => void;
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
                    ) {
                        if (p?.video.ended && p.item && p.item.kind !== 'live')
                            latest.current.startOver(p.item);
                        else p?.resume();
                    } else if (action === 'pause' || action === 'toggle')
                        p?.pause();
                    if (action === 'stop') {
                        const item = p?.item;
                        latest.current.stop();
                        if (latest.current.fullscreen)
                            latest.current.restore(
                                item?.kind === 'live' ? item.id : 'detail-play'
                            );
                    }
                    if (action === 'rewind') p?.seek(-10);
                    if (action === 'forward') p?.seek(10);
                }
            ),
        []
    );
}
