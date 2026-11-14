import { TvDialog, TvSelect } from '@iptvnator/tv/ui';
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
                Share sources with your self-hosted PWA. Viewing progress
                stays on this TV.
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
                        data-focus="library:url"
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
                        data-focus="library:token"
                        autoComplete="off"
                        value={token}
                        onInput={(event) => setToken(event.currentTarget.value)}
                    />
                </label>
                <button
                    disabled={tv.library.busy || !!tv.playing}
                    class="primary"
                    data-focus="library:connect"
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
                            data-focus="library:refresh"
                            onClick={() => void tv.library.refresh()}
                        >
                            Refresh library now
                        </button>
                        <button
                            data-focus="library:disconnect"
                            onClick={() => void tv.library.disconnect()}
                        >
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
                                <TvSelect
                                    label="Local source to copy to server"
                                    focusKey="library:source"
                                    value={sourceId}
                                    options={[
                                        { value: '', label: 'Choose a source' },
                                        ...local.map((s) => ({
                                            value: s.id,
                                            label: s.name,
                                        })),
                                    ]}
                                    onChange={setSourceId}
                                />
                            </label>
                            <p class="muted">
                                Copies connection details to this server.
                                Existing server sources are kept; favorites and
                                history are not uploaded.
                            </p>
                            <button
                                data-focus="library:upload"
                                disabled={
                                    !sourceId || tv.library.busy || !!tv.playing
                                }
                            >
                                Copy source to server
                            </button>
                        </form>
                    ) : null}
                    <SharedFavorites tv={tv} />
                </>
            ) : null}
        </section>
    );
}

function SharedFavorites({ tv }: { tv: TvModel }) {
    const [askUpload, setAskUpload] = useState(false);
    const sync = tv.favoritesSync;
    return (
        <section aria-label="Shared favorites">
            <h2>Shared favorites</h2>
            <p class="muted">
                Synchronize favorites with the server library, or keep them on
                this TV only. Switching never deletes favorites on this TV.
            </p>
            <TvSelect
                label="Favorites"
                focusKey="favorites:mode"
                value={sync.mode}
                options={[
                    { value: 'local', label: 'This TV only' },
                    { value: 'shared', label: 'Shared with the server' },
                ]}
                onChange={(value) => {
                    if (value === 'shared') {
                        if (sync.shareableCount) setAskUpload(true);
                        else void sync.setShared(true);
                    } else void sync.setShared(false);
                }}
            />
            {sync.mode === 'shared' ? (
                <>
                    <p class="muted">
                        {sync.counts.members} shared
                        {sync.counts.pending
                            ? ` · ${sync.counts.pending} changes pending`
                            : ' · up to date'}
                        {sync.counts.conflicts
                            ? ` · ${sync.counts.conflicts} conflicts`
                            : ''}
                    </p>
                    <div class="filters">
                        <button
                            disabled={sync.busy || !!tv.playing}
                            data-focus="favorites:refresh"
                            onClick={() => void sync.sync()}
                        >
                            Refresh favorites now
                        </button>
                        {sync.shareableCount ? (
                            <button
                                disabled={sync.busy || !!tv.playing}
                                data-focus="favorites:upload"
                                onClick={() => void sync.uploadLocal()}
                            >
                                Upload TV favorites
                            </button>
                        ) : null}
                    </div>
                </>
            ) : null}
            {sync.status ? <p role="status">{sync.status}</p> : null}
            {sync.error ? <p role="alert">{sync.error}</p> : null}
            {askUpload ? (
                <TvDialog
                    title="Share favorites from this TV?"
                    close={() => setAskUpload(false)}
                >
                    <p>
                        {sync.shareableCount} favorites on this TV can be
                        shared with the server. Items already on the server
                        are skipped. Nothing is deleted from this TV.
                    </p>
                    <div class="tv-card-options" role="group">
                        <button
                            class="primary"
                            data-dialog-initial
                            onClick={() => {
                                setAskUpload(false);
                                void sync.setShared(true, true);
                            }}
                        >
                            Upload TV favorites
                        </button>
                        <button
                            onClick={() => {
                                setAskUpload(false);
                                void sync.setShared(true);
                            }}
                        >
                            Keep on this TV only
                        </button>
                    </div>
                </TvDialog>
            ) : null}
        </section>
    );
}
