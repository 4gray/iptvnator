import { useEffect, useRef, useState } from 'preact/hooks';
import { ServerLibrary } from '@iptvnator/tv/data-access';
import { lumaFeed, lumaSelection, type Media } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

interface Config {
    url?: string;
    instanceId?: string;
    token?: string;
}
type PlatformWindow = Window & {
    __IPTVNATOR_LUMA__?: Config;
    webOSSystem?: { launchParams?: string };
    PalmSystem?: { launchParams?: string };
};

/** Explicit installation opt-in. Local IndexedDB remains authoritative. */
export function useLuma(tv: TvModel) {
    const { data, storageReady: loaded, ready, update, setError: report } = tv;
    const open = (item: Media) => {
        if (item.kind === 'episode') void tv.play(item);
        else tv.open(item);
    };
    const latest = useRef({ data, loaded, update, open, report });
    latest.current = { data, loaded, update, open, report };
    const [request, setRequest] = useState<unknown>();
    const changing = useRef(false);
    const platform = window as PlatformWindow;
    const config = platform.__IPTVNATOR_LUMA__;
    useEffect(() => {
        if (!config?.url || !config.instanceId) return;
        const receive = (event: Event) =>
            setRequest((event as CustomEvent).detail?.luma);
        document.addEventListener('webOSLaunch', receive);
        document.addEventListener('webOSRelaunch', receive);
        try {
            setRequest(
                JSON.parse(
                    (platform.webOSSystem ?? platform.PalmSystem)
                        ?.launchParams || '{}'
                ).luma
            );
        } catch {
            /* An ordinary launch has no card selection. */
        }
        return () => {
            document.removeEventListener('webOSLaunch', receive);
            document.removeEventListener('webOSRelaunch', receive);
        };
    }, []);
    useEffect(() => {
        if (!loaded || !request || changing.current) return;
        const item = lumaSelection(data, request);
        if (!item) {
            setRequest(undefined);
            report(
                'This Luma item is no longer saved on this TV. Open Favorites or Home.'
            );
            return;
        }
        if (item.sourceId !== data.activeId) {
            changing.current = true;
            void update((d) => ({ ...d, activeId: item.sourceId }))
                .catch(() => {
                    setRequest(undefined);
                    latest.current.report(
                        'The selected source could not be saved.'
                    );
                })
                .finally(() => {
                    changing.current = false;
                });
            return;
        }
        if (ready) {
            setRequest(undefined);
            open(item);
        }
    }, [loaded, request, data.activeId, ready]);
    useEffect(() => {
        if (!config?.url || !config.instanceId) return;
        const abort = new AbortController();
        const library = new ServerLibrary(
            config.url,
            config.token ?? '',
            config.instanceId
        );
        let busy = false;
        let previous = '';
        async function publish() {
            if (busy || !latest.current.loaded || abort.signal.aborted) return;
            const feed = lumaFeed(latest.current.data, 0);
            const signature = JSON.stringify(feed);
            if (previous === signature) return;
            busy = true;
            try {
                await library.publishLuma(
                    { ...feed, updatedAt: Date.now() },
                    abort.signal
                );
                previous = signature;
            } catch {
                /* Retry without interrupting playback or changing saved data. */
            } finally {
                busy = false;
            }
        }
        const first = setTimeout(() => void publish(), 2000);
        const timer = setInterval(() => void publish(), 15000);
        const visible = () => void publish();
        document.addEventListener('visibilitychange', visible);
        return () => {
            abort.abort();
            clearTimeout(first);
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
        };
    }, []);
}
