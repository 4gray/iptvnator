import { useEffect, useRef, useState } from 'preact/hooks';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import { LiveChannels } from './live-channels';
import { GridGuide } from './grid-guide';
import { ProgrammeGuide } from './programme-guide';
import type { TvModel } from './use-tv';
import type { useLiveBrowse } from './use-live-browse';

type Browse = ReturnType<typeof useLiveBrowse>;
type Panel = 'channels' | 'guide' | 'grid' | undefined;
/** Overlays own Back before the player, without replacing its video element. */
export function useLiveOverlay(tv: TvModel, browse: Browse) {
    const [panel, setPanel] = useState<Panel>();
    const origin = useRef('');
    const close = () => {
        if (panel === 'channels') browse.remember();
        setPanel(undefined);
        restoreFocus(
            origin.current,
            tv.fullscreen ? 'player-channels' : 'live-expand-guide'
        );
    };
    const open = (next: Exclude<Panel, undefined>) => {
        if (tv.route.view !== 'live') return;
        if (panel === 'channels') browse.remember();
        if (!panel) origin.current = focusKey();
        if (next === 'channels') browse.showPlaying();
        else if (tv.fullscreen && tv.playing) tv.setSelected(tv.playing);
        setPanel(next);
        restoreFocus(
            next === 'grid'
                ? 'grid-close'
                : next === 'guide'
                  ? 'guide-close'
                  : (tv.playing?.id ?? ''),
            'channels-close'
        );
    };
    const latest = useRef({ tv, panel, close, open });
    latest.current = { tv, panel, close, open };
    useEffect(() => {
        setPanel(undefined);
    }, [tv.data.activeId, tv.route.view, tv.fullscreen, tv.ready]);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const current = latest.current;
            const back =
                event.keyCode === 461 ||
                ['Escape', 'BrowserBack', 'Backspace'].includes(event.key);
            if (current.panel && back) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const nested = document.querySelector('.grid-guide');
                if (
                    !nested ||
                    nested.dispatchEvent(
                        new Event('tv-overlay-back', { cancelable: true })
                    )
                )
                    current.close();
            } else if (
                !current.panel &&
                current.tv.fullscreen &&
                current.tv.playing?.kind === 'live' &&
                (event.key === 'ArrowLeft' || event.keyCode === 37) &&
                document.querySelector('.player-controls.dormant')
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                current.open('channels');
            } else if (current.panel && event.key === 'Tab') {
                const buttons = Array.from(
                    document.querySelectorAll<HTMLElement>(
                        '[data-tv-modal] button:not(:disabled),[data-tv-modal] [data-tv-scroll]'
                    )
                ).filter((e) => !!e.offsetWidth && !e.closest('[hidden]'));
                const index = buttons.indexOf(
                    document.activeElement as HTMLElement
                );
                const next =
                    (index + (event.shiftKey ? -1 : 1) + buttons.length) %
                    buttons.length;
                buttons[next]?.focus();
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        document.addEventListener('keydown', key, true);
        return () => document.removeEventListener('keydown', key, true);
    }, []);
    return {
        panel,
        close,
        openGuide: () => open('guide'),
        openGrid: () => open('grid'),
        openChannels: () => open('channels'),
    };
}

export function LiveOverlay({
    tv,
    browse,
    overlay,
}: {
    tv: TvModel;
    browse: Browse;
    overlay: ReturnType<typeof useLiveOverlay>;
}) {
    if (!overlay.panel) return null;
    return (
        <div class={`live-overlay ${overlay.panel}-overlay`}>
            <div class="live-overlay-shade" onClick={overlay.close} />
            <div
                class="live-overlay-panel"
                role="dialog"
                aria-modal="true"
                aria-label={
                    overlay.panel === 'grid'
                        ? 'Multi-channel programme guide'
                        : overlay.panel === 'guide'
                          ? 'Expanded programme guide'
                          : 'Channel browser'
                }
                data-tv-modal
            >
                {overlay.panel === 'grid' ? (
                    <GridGuide tv={tv} close={overlay.close} />
                ) : overlay.panel === 'guide' ? (
                    <ProgrammeGuide
                        programs={tv.epg}
                        channel={tv.selected}
                        enabled={tv.data.epg}
                        error={tv.epgError}
                        close={overlay.close}
                    />
                ) : (
                    <>
                        <div class="drawer-toolbar">
                            <button
                                data-focus="channels-close"
                                onClick={overlay.close}
                            >
                                Close ×
                            </button>
                            <button onClick={overlay.openGuide}>
                                Programme
                            </button>
                        </div>
                        <button
                            class="drawer-grid-button"
                            onClick={overlay.openGrid}
                        >
                            TV Guide
                        </button>
                        <LiveChannels tv={tv} browse={browse} overlay />
                        {tv.error ? (
                            <p role="alert">
                                {tv.error}
                                <button onClick={tv.retryPlayback}>
                                    Retry playback
                                </button>
                            </p>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
