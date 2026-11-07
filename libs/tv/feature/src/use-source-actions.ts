import { isCollectionView, isSavedView } from './navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import { isBackKey, type Media, type Source } from '@iptvnator/tv/util';
import { navigationOrigin, type NavigationOrigin } from './use-route-history';
import type { TvModel } from './use-tv';

const connection = (s: Source) =>
    JSON.stringify([
        s.id,
        s.provider,
        s.url,
        s.username,
        s.password,
        s.macAddress,
        s.serialNumber,
        s.deviceId1,
        s.deviceId2,
        s.signature1,
        s.signature2,
        s.userAgent,
        s.referrer,
        s.origin,
        s.m3uItems,
    ]);
interface SourceRequest {
    item: Media;
    intent: 'open' | 'play' | 'previous';
    origin: NavigationOrigin;
    source: string;
    backend: string;
    activated: boolean;
    generation: number;
    context: string;
    retryLabel: string;
}

/** Saved items activate their exact source before opening or playing. */
export function useSourceActions(
    tv: TvModel,
    series: {
        open: (item: Media, origin?: NavigationOrigin) => Promise<void>;
        cancel: () => void;
        busy: boolean;
    }
) {
    const context = JSON.stringify([
        tv.route.view,
        tv.route.kind,
        tv.data.favoriteScope,
    ]);
    const [pending, setPending] = useState<SourceRequest>();
    const request = useRef<SourceRequest>();
    const details = useRef<SourceRequest>();
    const playback = useRef<{
        job: SourceRequest;
        controller: AbortController;
    }>();
    const generation = useRef(0);
    const sourceSave = useRef<{ done: boolean }>();
    const [, flushSourceSave] = useState(0);
    const latest = useRef({ tv, series, context });
    latest.current = { tv, series, context };
    const cancel = (restore = false) => {
        const job = request.current;
        request.current = undefined;
        setPending(undefined);
        if (restore && job)
            restoreFocus(job.origin.focus, 'nav:home', job.origin.scroll);
    };
    const abortIntent = (restore = false) => {
        generation.current++;
        const playing = playback.current;
        playback.current = undefined;
        playing?.controller.abort();
        if (
            playing &&
            (playing.job.intent !== 'previous' ||
                latest.current.tv.player.current?.item?.id ===
                    playing.job.item.id)
        )
            latest.current.tv.stop();
        if (
            [
                'Retry previous channel',
                'Retry Home title',
                'Retry favorite',
                'Retry History title',
                'Retry series details',
            ].includes(latest.current.tv.errorRetryLabel ?? '')
        )
            latest.current.tv.setError('');
        if (restore && playing)
            restoreFocus(
                playing.job.origin.focus,
                'hero',
                playing.job.origin.scroll
            );
        const detail = details.current;
        latest.current.series.cancel();
        details.current = undefined;
        if (restore && detail)
            restoreFocus(detail.origin.focus, 'hero', detail.origin.scroll);
        cancel(restore);
    };
    const perform = (job: SourceRequest) => {
        const current = latest.current;
        if (
            job.intent !== 'open' ||
            (job.item.kind === 'live' &&
                isCollectionView(current.tv.route.view))
        ) {
            const owned = { job, controller: new AbortController() };
            playback.current = owned;
            setPending(job);
            void current.tv
                .play(
                    job.item,
                    '',
                    job.intent === 'previous'
                        ? current.tv.playbackOrigin
                        : job.origin,
                    owned.controller.signal,
                    {
                        retry: () => {
                            if (generation.current === job.generation)
                                start(job.item, job.intent, job.origin);
                        },
                        label:
                            job.intent === 'previous'
                                ? job.retryLabel
                                : undefined,
                    },
                    job.intent === 'previous'
                )
                .then((started) => {
                    if (playback.current !== owned) return;
                    // A failed resolution retains ownership of its Retry notice
                    // until the user retries, changes title or leaves Home.
                    if (started) {
                        playback.current = undefined;
                        if (job.intent === 'previous') {
                            latest.current.tv.setSelected(job.item);
                            latest.current.tv.setFullscreen(true);
                            restoreFocus('player-previous', 'player-toggle');
                        }
                    }
                    setPending(undefined);
                });
        } else if (job.item.kind === 'episode') {
            details.current = job;
            void current.series.open(job.item, job.origin).finally(() => {
                if (details.current === job) details.current = undefined;
            });
        } else current.tv.open(job.item, job.origin);
    };
    const fail = (job: SourceRequest) => {
        if (request.current !== job) return;
        cancel(true);
        latest.current.tv.setError(
            'This source could not be opened. Check its connection and retry.',
            () => {
                if (generation.current === job.generation)
                    start(job.item, job.intent, job.origin);
            },
            job.retryLabel
        );
    };
    function start(
        item: Media,
        intent: SourceRequest['intent'],
        origin = navigationOrigin()
    ) {
        const current = latest.current.tv;
        if (
            intent === 'previous'
                ? current.route.view !== 'live' || item.kind !== 'live'
                : !isSavedView(current.route.view) || current.fullscreen
        )
            return;
        abortIntent();
        const source = current.data.sources.find((s) => s.id === item.sourceId);
        if (!source) {
            current.setError(
                'This title belongs to a source that is no longer available. Restore the source in Sources to watch it.'
            );
            return;
        }
        current.setError('');
        const job: SourceRequest = {
            item,
            intent,
            origin,
            source: connection(source),
            backend: JSON.stringify([
                current.data.backend,
                current.data.backendToken,
            ]),
            activated: false,
            generation: generation.current,
            context,
            retryLabel:
                intent === 'previous'
                    ? 'Retry previous channel'
                    : current.route.view === 'home'
                      ? 'Retry Home title'
                      : current.route.view === 'history'
                        ? 'Retry History title'
                        : 'Retry favorite',
        };
        if (
            item.sourceId === current.data.activeId &&
            current.ready &&
            !sourceSave.current
        ) {
            perform(job);
            return;
        }
        request.current = job;
        setPending(job);
        if (item.sourceId === current.data.activeId && !sourceSave.current) {
            job.activated = true;
            current.retryConnection();
        } else {
            const save = { done: false };
            sourceSave.current = save;
            void current
                .switchSource(
                    item.sourceId,
                    () =>
                        request.current === job &&
                        latest.current.context === job.context
                )
                .then((success) => {
                    save.done = true;
                    // A render must acknowledge the persisted source before
                    // another action can trust the model's ready fast path.
                    flushSourceSave((revision) => revision + 1);
                    if (request.current !== job) return;
                    if (!success) {
                        fail(job);
                        return;
                    }
                    job.activated = true;
                    setPending({ ...job });
                });
        }
    }
    useLayoutEffect(() => {
        const launched = playback.current;
        if (
            launched &&
            launched.job.intent !== 'previous' &&
            tv.fullscreen &&
            tv.playing?.id === launched.job.item.id
        ) {
            // The player now owns native loading, errors and Back.
            playback.current = undefined;
            setPending(undefined);
        }
        const launchedSource = tv.data.sources.find(
            (s) => s.id === launched?.job.item.sourceId
        );
        if (
            launched?.job.intent === 'previous' &&
            (context !== launched.job.context ||
                !launchedSource ||
                connection(launchedSource) !== launched.job.source ||
                JSON.stringify([tv.data.backend, tv.data.backendToken]) !==
                    launched.job.backend)
        )
            abortIntent();
        if (sourceSave.current?.done) sourceSave.current = undefined;
        const job = request.current;
        if (!job) return;
        const source = tv.data.sources.find((s) => s.id === job.item.sourceId);
        if (
            context !== job.context ||
            !source ||
            connection(source) !== job.source ||
            JSON.stringify([tv.data.backend, tv.data.backendToken]) !==
                job.backend ||
            (job.activated && tv.data.activeId !== job.item.sourceId)
        ) {
            cancel();
            return;
        }
        if (
            job.activated &&
            tv.data.activeId === job.item.sourceId &&
            tv.ready
        ) {
            cancel();
            perform(job);
        } else if (
            job.activated &&
            !tv.busy &&
            tv.errorRetryLabel === 'Retry connection'
        )
            fail(job);
    });
    const waitingDetails =
        series.busy &&
        !!details.current &&
        isSavedView(tv.route.view) &&
        !tv.fullscreen;
    useEffect(() => {
        if (!pending && !waitingDetails) return;
        const job = request.current;
        const timer = setTimeout(() => {
            if (job) fail(job);
        }, 40000);
        const back = (event: KeyboardEvent) => {
            if (
                (latest.current.tv.fullscreen &&
                    (request.current ?? playback.current?.job)?.intent !==
                        'previous') ||
                document.querySelector('[data-tv-modal]') ||
                (!request.current && !details.current && !playback.current)
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
            abortIntent(true);
        };
        document.addEventListener('keydown', back, true);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('keydown', back, true);
        };
    }, [pending, waitingDetails]);
    useEffect(
        () => () => {
            request.current = undefined;
            const playing = playback.current;
            playback.current = undefined;
            playing?.controller.abort();
        },
        []
    );
    useEffect(() => {
        if (
            (tv.errorRetryLabel === 'Retry previous channel' &&
                tv.route.view !== 'live') ||
            ([
                'Retry Home title',
                'Retry favorite',
                'Retry History title',
            ].includes(tv.errorRetryLabel ?? '') &&
                !isSavedView(tv.route.view))
        )
            tv.setError('');
    }, [tv.route.view, tv.errorRetryLabel]);
    return {
        open: (item: Media, origin?: NavigationOrigin) =>
            start(item, 'open', origin),
        play: (item: Media, origin?: NavigationOrigin) =>
            start(item, 'play', origin),
        previous: (item: Media) =>
            start(item, 'previous', navigationOrigin('player-previous')),
        pending: !!pending,
        sourceName: pending
            ? tv.data.sources.find(
                  (source) => source.id === pending.item.sourceId
              )?.name
            : undefined,
        cancel: () => abortIntent(true),
        leave: () => abortIntent(),
    };
}
