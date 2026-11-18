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
    const settings = state.settings;
    const autoplay =
        settings?.seriesAutoplay === undefined
            ? ''
            : ` · Autoplay ${settings.seriesAutoplay ? 'on' : 'off'}`;
    const upNext =
        settings?.playerUpNextCard === undefined
            ? ''
            : ` · Up next card ${settings.playerUpNextCard ? 'on' : 'off'}`;
    return (
        <div class="phone-review">
            <p class="eyebrow">RECEIVED FROM YOUR PHONE</p>
            <h3>{settings ? 'TV settings' : state.source!.name}</h3>
            <p>
                {settings
                    ? `TMDB ${settings.tmdb.enabled ? 'on' : 'off'} · ${settings.tmdb.language.toUpperCase()} · ${settings.layout === 'cinema' ? 'Cinema' : 'Showcase'} · EPG ${settings.epg ? 'on' : 'off'}${autoplay}${upNext}`
                    : `${state.source!.provider.toUpperCase()} · ${new URL(state.source!.url).hostname}`}
            </p>
            <p class="muted">
                {settings
                    ? `Apply these settings? TMDB key: ${settings.tmdb.apiKey ? 'replace with the key from your phone' : 'keep existing'}.`
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
                          : settings
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
