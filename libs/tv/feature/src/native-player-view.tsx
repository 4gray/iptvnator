import { useLayoutEffect } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { RefObject } from 'preact';
import type { VodSequence } from './use-vod-sequence';
import { episodeCode, mediaTitle } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import type { useLiveOverlay } from './live-overlay';
import type { useSeriesDetails } from './use-series-details';

export function NativePlayerView({
    tv,
    video,
    controlsVisible,
    overlay,
    seriesDetails,
    back,
    openPlaylist,
    vod,
    previousChannel,
}: {
    tv: TvModel;
    video: RefObject<HTMLVideoElement>;
    controlsVisible: boolean;
    overlay: ReturnType<typeof useLiveOverlay>;
    seriesDetails: ReturnType<typeof useSeriesDetails>;
    back: () => void;
    openPlaylist: () => void;
    vod: VodSequence;
    previousChannel: { play: () => void; pending: boolean };
}) {
    const current = tv.playing;
    const element = video.current;
    useLayoutEffect(() => {
        if (!element?.ended || !vod.next || !tv.fullscreen) return;
        let owns = true;
        restoreFocus('player-next', '', undefined, () => owns);
        return () => {
            owns = false;
        };
    }, [element?.ended, vod.next?.id, tv.fullscreen]);
    const sourceName =
        tv.data.sources.find((source) => source.id === current?.sourceId)
            ?.name ?? 'Source unavailable';
    const time = (seconds: number) =>
        Number.isFinite(seconds)
            ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
            : 'LIVE';
    return (
        <div
            class={`native-player ${tv.fullscreen ? 'fullscreen' : 'preview'}`}
            hidden={!current}
        >
            <video ref={video} playsInline preload="metadata" />
            {tv.fullscreen ? (
                <div
                    class={`player-controls ${controlsVisible || tv.error ? '' : 'dormant'}`}
                    hidden={!!overlay.panel}
                >
                    <div class="player-top">
                        <button data-focus="player-back" onClick={back}>
                            ← Back
                        </button>
                        {current?.kind === 'live' ? (
                            <div class="actions">
                                {tv.previousChannel ? (
                                    <button
                                        data-focus="player-previous"
                                        disabled={previousChannel.pending}
                                        onClick={previousChannel.play}
                                    >
                                        Previous channel ·{' '}
                                        {tv.previousChannel.title}
                                    </button>
                                ) : null}
                                <button
                                    data-focus="player-channels"
                                    onClick={overlay.openChannels}
                                >
                                    Channels
                                </button>
                                <button
                                    data-focus="player-grid"
                                    onClick={overlay.openGrid}
                                >
                                    TV Guide
                                </button>
                                <button
                                    data-focus="player-guide"
                                    onClick={overlay.openGuide}
                                >
                                    Programme
                                </button>
                            </div>
                        ) : null}
                        <span>
                            {current?.kind === 'live'
                                ? 'LIVE TELEVISION'
                                : 'NOW WATCHING'}
                        </span>
                    </div>
                    <div class="player-bottom">
                        <span class="eyebrow">
                            {current?.season
                                ? `SEASON ${current.season} · EPISODE ${current.episode}`
                                : 'IPTVNATOR TV'}
                        </span>
                        <h1>{current && mediaTitle(current)}</h1>
                        <p class="player-source-name">{sourceName}</p>
                        {current?.kind === 'episode' ? (
                            <p>{current.title}</p>
                        ) : null}
                        {element?.ended && current?.kind === 'episode' ? (
                            <p role="status">
                                Episode finished.{' '}
                                {vod.next
                                    ? 'Choose Next episode to continue.'
                                    : vod.busy
                                      ? 'Finding the next episode…'
                                      : vod.failed
                                        ? 'Next episode is unavailable.'
                                        : 'No next episode was supplied.'}
                            </p>
                        ) : null}
                        {current?.kind === 'episode' && vod.failed ? (
                            <button onClick={vod.retry}>
                                Retry next episode
                            </button>
                        ) : null}
                        <div class="actions">
                            {vod.next ? (
                                <button
                                    class={element?.ended ? 'primary' : ''}
                                    data-focus="player-next"
                                    disabled={vod.activating}
                                    onClick={vod.playNext}
                                >
                                    Next episode · {episodeCode(vod.next)} →
                                </button>
                            ) : null}
                            <button
                                data-focus="player-toggle"
                                class="primary"
                                onClick={() =>
                                    element?.ended &&
                                    current &&
                                    current.kind !== 'live'
                                        ? tv.startOver(current)
                                        : tv.player.current?.toggle()
                                }
                            >
                                {element?.ended && current?.kind !== 'live'
                                    ? 'Watch again ▶'
                                    : element?.paused
                                      ? 'Play ▶'
                                      : 'Pause Ⅱ'}
                            </button>
                            {current?.kind === 'episode' ? (
                                <button
                                    data-focus="player-series-details"
                                    disabled={seriesDetails.busy}
                                    onClick={() =>
                                        void seriesDetails.open(current)
                                    }
                                >
                                    {seriesDetails.busy
                                        ? 'Finding series…'
                                        : 'Series details →'}
                                </button>
                            ) : null}
                            {current?.kind !== 'live' ? (
                                <>
                                    <button
                                        onClick={() =>
                                            tv.player.current?.seek(-10)
                                        }
                                    >
                                        −10 sec
                                    </button>
                                    <button
                                        onClick={() =>
                                            tv.player.current?.seek(10)
                                        }
                                    >
                                        +10 sec
                                    </button>
                                    <span>
                                        {time(element?.currentTime ?? 0)} /{' '}
                                        {time(element?.duration ?? 0)}
                                    </span>
                                </>
                            ) : null}
                            {current?.kind === 'live' ? (
                                <button
                                    data-focus="player-playlist"
                                    onClick={openPlaylist}
                                >
                                    Go to playlist
                                </button>
                            ) : null}
                            <button
                                aria-pressed={tv.data.favorites.some(
                                    (item) => item.id === current?.id
                                )}
                                onClick={() => current && tv.favorite(current)}
                            >
                                {tv.data.favorites.some(
                                    (item) => item.id === current?.id
                                )
                                    ? '♥ Saved'
                                    : '♡ Save'}
                            </button>
                        </div>
                        {current?.kind !== 'live' ? (
                            <label class="seek">
                                Playback position
                                <input
                                    aria-label="Playback position"
                                    type="range"
                                    min="0"
                                    max={
                                        Number.isFinite(element?.duration)
                                            ? (element?.duration ?? 0)
                                            : 0
                                    }
                                    value={element?.currentTime ?? 0}
                                    onInput={(e) => {
                                        tv.player.current?.seekTo(
                                            Number(e.currentTarget.value)
                                        );
                                    }}
                                />
                            </label>
                        ) : null}
                        {tv.player.current?.restoringPosition ? (
                            <p role="status">Restoring saved position…</p>
                        ) : null}
                        {tv.error ? (
                            <div role="alert" class="error">
                                {tv.error}
                                {tv.errorRetry ? (
                                    <button onClick={tv.errorRetry}>
                                        {tv.errorRetryLabel}
                                    </button>
                                ) : null}
                                <button onClick={() => tv.setError('')}>
                                    Dismiss
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
