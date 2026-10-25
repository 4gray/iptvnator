import { useLayoutEffect, useState } from 'preact/hooks';
import type { TvModel } from './use-tv';

export function LibrarySettings({ tv }: { tv: TvModel }) {
    const saved = tv.data.library;
    const [url, setUrl] = useState(saved?.url ?? '');
    const [token, setToken] = useState(saved?.token ?? '');
    const [sourceId, setSourceId] = useState('');
    const local = tv.data.sources.filter((s) => !s.libraryId);
    useLayoutEffect(() => {
        setUrl(saved?.url ?? '');
        setToken(saved?.token ?? '');
    }, [saved?.url, saved?.token]);
    return (
        <section class="source-form" aria-label="Server library">
            <h2>Server library</h2>
            <p class="muted">
                Share sources with your self-hosted PWA. Favorites and viewing
                progress stay on this TV.
            </p>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void tv.library.connect(url, token);
                }}
            >
                <label>
                    Library server URL
                    <input
                        type="url"
                        required
                        value={url}
                        placeholder="http://nas:4333/api"
                        onInput={(event) => {
                            setUrl(event.currentTarget.value);
                            setToken('');
                        }}
                    />
                </label>
                <label>
                    Library access token (if required)
                    <input
                        type="password"
                        autoComplete="off"
                        value={token}
                        onInput={(event) => setToken(event.currentTarget.value)}
                    />
                </label>
                <button
                    disabled={tv.library.busy || !!tv.playing}
                    class="primary"
                >
                    Connect library
                </button>
            </form>
            {tv.library.status ? (
                <p role="status">{tv.library.status}</p>
            ) : null}
            {tv.library.error ? <p role="alert">{tv.library.error}</p> : null}
            {saved ? (
                <>
                    <p class="muted">
                        Last synchronized:{' '}
                        {new Date(saved.lastSync).toLocaleString()}. Sources
                        refresh on launch, on return and every minute while not
                        playing.
                    </p>
                    <div class="filters">
                        <button
                            disabled={tv.library.busy || !!tv.playing}
                            onClick={() => void tv.library.refresh()}
                        >
                            Refresh library now
                        </button>
                        <button onClick={() => void tv.library.disconnect()}>
                            Disconnect library
                        </button>
                    </div>
                    <p class="muted">
                        Manage server sources in the PWA. Disconnecting keeps
                        downloaded sources on this TV. Removing a server source
                        removes its linked TV entry after refresh; viewing data
                        is retained.
                    </p>
                    {local.length ? (
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void tv.library.upload(sourceId);
                            }}
                        >
                            <label>
                                Local source to copy to server
                                <select
                                    required
                                    value={sourceId}
                                    onChange={(event) =>
                                        setSourceId(event.currentTarget.value)
                                    }
                                >
                                    <option value="">Choose a source</option>
                                    {local.map((s) => (
                                        <option value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </label>
                            <p class="muted">
                                Copies connection details to this server.
                                Existing server sources are kept; favorites and
                                history are not uploaded.
                            </p>
                            <button
                                disabled={
                                    !sourceId || tv.library.busy || !!tv.playing
                                }
                            >
                                Copy source to server
                            </button>
                        </form>
                    ) : null}
                </>
            ) : null}
        </section>
    );
}
