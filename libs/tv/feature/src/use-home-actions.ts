import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import type { Media, Source } from '@iptvnator/tv/util';
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
interface HomeRequest {
    item: Media;
    intent: 'open' | 'play';
    origin: NavigationOrigin;
    source: string;
    backend: string;
    activated: boolean;
}

/** Only a deliberate Home action may activate another source and launch a title. */
export function useHomeActions(
    tv: TvModel,
    series: {
        open: (item: Media, origin?: NavigationOrigin) => Promise<void>;
        cancel: () => void;
        busy: boolean;
    }
) {
    const [pending, setPending] = useState<HomeRequest>();
    const request = useRef<HomeRequest>();
    const details = useRef<HomeRequest>();
    const sourceSave = useRef<{ done: boolean }>();
    const [, flushSourceSave] = useState(0);
    const latest = useRef({ tv, series });
    latest.current = { tv, series };
    const cancel = (restore = false) => {
        const job = request.current;
        request.current = undefined;
        setPending(undefined);
        if (restore && job)
            restoreFocus(job.origin.focus, 'nav:home', job.origin.scroll);
    };
    const abortIntent = (restore = false) => {
        const detail = details.current;
        latest.current.series.cancel();
        details.current = undefined;
        if (restore && detail)
            restoreFocus(detail.origin.focus, 'hero', detail.origin.scroll);
        cancel(restore);
    };
    const perform = (job: HomeRequest) => {
        const current = latest.current;
        if (job.intent === 'play')
            void current.tv.play(job.item, '', job.origin);
        else if (job.item.kind === 'episode') {
            details.current = job;
            void current.series.open(job.item, job.origin).finally(() => {
                if (details.current === job) details.current = undefined;
            });
        } else current.tv.open(job.item, job.origin);
    };
    const fail = (job: HomeRequest) => {
        if (request.current !== job) return;
        cancel(true);
        latest.current.tv.setError(
            'This source could not be opened. Check its connection and retry.',
            () => start(job.item, job.intent, job.origin),
            'Retry Home title'
        );
    };
    function start(
        item: Media,
        intent: HomeRequest['intent'],
        origin = navigationOrigin()
    ) {
        const current = latest.current.tv;
        if (current.route.view !== 'home' || current.fullscreen) return;
        abortIntent();
        const source = current.data.sources.find((s) => s.id === item.sourceId);
        if (!source) {
            current.setError(
                'This title belongs to a source that is no longer available. Restore the source in Sources to watch it.'
            );
            return;
        }
        current.setError('');
        const job: HomeRequest = {
            item,
            intent,
            origin,
            source: connection(source),
            backend: JSON.stringify([
                current.data.backend,
                current.data.backendToken,
            ]),
            activated: false,
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
                        latest.current.tv.route.view === 'home'
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
        if (sourceSave.current?.done) sourceSave.current = undefined;
        const job = request.current;
        if (!job) return;
        const source = tv.data.sources.find((s) => s.id === job.item.sourceId);
        if (
            tv.route.view !== 'home' ||
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
        tv.route.view === 'home' &&
        !tv.fullscreen;
    useEffect(() => {
        if (!pending && !waitingDetails) return;
        const job = request.current;
        const timer = setTimeout(() => {
            if (job) fail(job);
        }, 40000);
        const back = (event: KeyboardEvent) => {
            if (!request.current && !details.current) return;
            if (
                event.keyCode !== 461 &&
                !['Escape', 'BrowserBack', 'Backspace'].includes(event.key)
            )
                return;
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
        },
        []
    );
    useEffect(() => {
        if (
            tv.errorRetryLabel === 'Retry Home title' &&
            tv.route.view !== 'home'
        )
            tv.setError('');
    }, [tv.route.view, tv.errorRetryLabel]);
    return {
        open: (item: Media) => start(item, 'open'),
        play: (item: Media) => start(item, 'play'),
        pending: !!pending,
        cancel: () => abortIntent(true),
        leave: () => abortIntent(),
    };
}
