import { useEffect, useState } from 'preact/hooks';
import { ServerLibrary } from '@iptvnator/tv/data-access';
import type { TvModel } from './use-tv';

/** Optional source-library capability of the already selected, trusted server. */
export function HomeServer({ tv }: { tv: TvModel }) {
    const url = tv.data.backend;
    const [capability, setCapability] = useState<{
        url: string;
        available: boolean;
    }>();
    useEffect(() => {
        if (!url) return;
        const controller = new AbortController();
        setCapability(undefined);
        // Identity is public. Credentials are sent only after the explicit Connect action.
        new ServerLibrary(url, '')
            .identify(controller.signal)
            .then(() => {
                if (!controller.signal.aborted)
                    setCapability({ url, available: true });
            })
            .catch(() => {
                if (!controller.signal.aborted)
                    setCapability({ url, available: false });
            });
        return () => controller.abort();
    }, [url]);
    if (!url || capability?.url !== url) return null;
    const linked = tv.data.library?.url === url;
    return (
        <section aria-label="Home server sources">
            <h3>Your home server</h3>
            <p class="muted">
                {capability.available
                    ? 'This server supports playback requests, phone setup and a shared source library.'
                    : 'This server supports phone setup and playback requests. A shared source library is not available at this address.'}
            </p>
            {capability.available ? (
                <>
                    <button
                        type="button"
                        data-focus="home-server:connect"
                        disabled={tv.library.busy || !!tv.playing || linked}
                        onClick={() =>
                            void tv.library.connect(url, tv.data.backendToken)
                        }
                    >
                        {linked
                            ? 'Server sources connected'
                            : 'Use this server’s sources'}
                    </button>
                    <p class="muted">
                        Sources are shared; favorites and viewing progress stay
                        on this TV.
                    </p>
                    {tv.library.status ? (
                        <p role="status">{tv.library.status}</p>
                    ) : null}
                    {tv.library.error ? (
                        <p role="alert">
                            {tv.library.error} Configure a separate library or
                            token in Settings.
                        </p>
                    ) : null}
                </>
            ) : (
                <p class="muted">
                    Add a source from your phone, or connect a separate source
                    library in Settings.
                </p>
            )}
        </section>
    );
}
