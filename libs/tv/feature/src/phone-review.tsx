import type { PairingState } from '@iptvnator/tv/data-access';
export function PhoneReview({
    state,
    busy,
    remaining,
    saved,
    confirm,
    decline,
}: {
    state: PairingState;
    busy: boolean;
    remaining: number;
    saved: boolean;
    confirm: () => void;
    decline: () => void;
}) {
    const isSettings = !!state.settings;
    return (
        <div class="phone-review">
            <p class="eyebrow">RECEIVED FROM YOUR PHONE</p>
            <h3>{isSettings ? 'TV settings' : state.source!.name}</h3>
            <p>
                {isSettings
                    ? `TMDB ${state.settings!.tmdb.enabled ? 'on' : 'off'} · ${state.settings!.tmdb.language.toUpperCase()} · ${state.settings!.layout === 'cinema' ? 'Cinema' : 'Showcase'} · EPG ${state.settings!.epg ? 'on' : 'off'}`
                    : `${state.source!.provider.toUpperCase()} · ${new URL(state.source!.url).hostname}`}
            </p>
            <p class="muted">
                {isSettings
                    ? `Apply these settings? TMDB key: ${state.settings!.tmdb.apiKey ? 'replace with the key from your phone' : 'keep existing'}.`
                    : 'Add this source to your TV?'}
            </p>
            <div class="actions">
                <button
                    type="button"
                    class="primary"
                    data-focus="phone-confirm"
                    disabled={busy || !remaining}
                    onClick={() => confirm()}
                >
                    {busy
                        ? 'Saving…'
                        : saved
                          ? 'Retry confirmation'
                          : isSettings
                            ? 'Apply settings'
                            : 'Add source'}
                </button>
                <button
                    type="button"
                    disabled={busy || saved}
                    onClick={() => decline()}
                >
                    Decline
                </button>
            </div>
        </div>
    );
}
