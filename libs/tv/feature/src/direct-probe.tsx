import { useState } from 'preact/hooks';
import { probeDirect } from '@iptvnator/tv/data-access';
import { TvModel } from './use-tv';
export function DirectAccessProbe({ tv }: { tv: TvModel }) {
    const [result, setResult] = useState<{ catalog: string; media: string }>();
    const [busy, setBusy] = useState(false);
    const source = tv.data.sources.find((s) => s.id === tv.data.activeId);
    return (
        <section class="probe">
            <h2>Direct access check</h2>
            <p class="muted">
                This optional check sends one catalog request directly to your
                selected provider from this device, including Xtream login
                details. It checks media HTTP headers separately using the last
                stream address. The backend remains selected.
            </p>
            <button
                data-focus="settings:direct-probe"
                disabled={!source || busy}
                onClick={async () => {
                    if (!source) return;
                    setBusy(true);
                    try {
                        setResult(
                            await probeDirect(
                                source,
                                tv.player.current?.lastPlayback?.sourceId ===
                                    source.id
                                    ? tv.player.current.lastPlayback.url
                                    : undefined
                            )
                        );
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {busy ? 'Checking…' : 'Test direct access'}
            </button>
            {result ? (
                <div role="status">
                    <p>Catalog: {result.catalog}</p>
                    <p>Media: {result.media}</p>
                </div>
            ) : null}
        </section>
    );
}
