import { TvIcon } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
import { HomeServer } from './home-server';
export function BackendConnection({
    tv,
    label = 'IPTVnator backend URL',
}: {
    tv: TvModel;
    label?: string;
}) {
    const b = tv.backend;
    return (
        <section class="backend-connection" aria-label="Backend connection">
            <h2>Connect your home server</h2>
            <p class="muted">
                Find IPTVnator on your home network, or enter your server
                address below.
            </p>
            <div
                class={`connection-status ${b.connected ? 'connected' : ''}`}
                role="status"
            >
                {b.connected ? (
                    <TvIcon name="check" />
                ) : (
                    <span class="connection-dot" aria-hidden="true" />
                )}
                {b.status}
            </div>
            <label>
                {label}
                <input
                    data-focus="backend:url"
                    name="backend"
                    type="url"
                    required
                    value={b.url}
                    onInput={(event) => b.editUrl(event.currentTarget.value)}
                    placeholder="http://your-server:3333"
                />
            </label>
            <details>
                <summary data-focus="backend:token-details">
                    Backend access token (if required)
                </summary>
                <label>
                    Backend access token
                    <input
                        data-focus="backend:token"
                        name="backendToken"
                        type="password"
                        value={b.token}
                        onInput={(event) =>
                            b.editToken(event.currentTarget.value)
                        }
                        autoComplete="off"
                    />
                </label>
            </details>
            <div class="actions">
                <button
                    type="button"
                    data-focus="backend:connect"
                    onClick={() => void b.connect()}
                    disabled={!b.url}
                >
                    Check and connect
                </button>
                <button
                    type="button"
                    data-focus="backend:find"
                    onClick={() => (b.searching ? b.cancel() : void b.find())}
                >
                    {b.searching ? 'Cancel search' : 'Find backend'}
                </button>
            </div>
            {b.found.length ? (
                <div class="backend-results">
                    {b.found.map((info) => (
                        <button
                            type="button"
                            key={info.url}
                            data-focus={`backend:found:${info.url}`}
                            onClick={() => b.choose(info)}
                        >
                            {info.url}
                            {info.auth === 'token' ? ' · token required' : ''}
                        </button>
                    ))}
                </div>
            ) : null}
            <p class="muted">
                Use a backend you trust: source login details go to this
                address. Local search checks standard IPTVnator ports; you can
                always enter another address.
            </p>
            <HomeServer tv={tv} />
        </section>
    );
}
