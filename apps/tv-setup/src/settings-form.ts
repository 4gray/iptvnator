import type { PhoneSettingsDefaults, PlaybackDraft } from '@iptvnator/tv/util';
/** The playback switches, only when the TV offered them. */
export function playbackValues(
    form: HTMLFormElement,
    values: FormData
): PlaybackDraft {
    if (form.querySelector<HTMLElement>('#playback')?.hidden !== false)
        return {};
    return {
        seriesAutoplay: values.has('seriesAutoplay'),
        playerUpNextCard: values.has('playerUpNextCard'),
    };
}
/** No saved key enters the phone DOM; an empty replacement preserves the TV key. */
export function settingsForm(
    form: HTMLFormElement,
    defaults: PhoneSettingsDefaults
) {
    document.title = 'TV settings · IPTVnator';
    document.querySelector('h1')!.textContent = 'Your TV. Your preferences.';
    document.querySelector('.intro')!.textContent =
        'Adjust settings here, then confirm on your television.';
    form.innerHTML = `<label>Home layout<select name="layout"><option value="cinema">Кинозал · Cinema</option><option value="shelf">Витрина · Showcase</option></select></label>
        <label class="check"><input type="checkbox" name="epg"> Show programme guide</label>
        <div id="playback" hidden><h2>Playback</h2>
        <label class="check"><input type="checkbox" name="seriesAutoplay"> Autoplay next episode</label>
        <label class="check"><input type="checkbox" name="playerUpNextCard"> "Up next" card</label></div>
        <h2>Metadata · TMDB</h2>
        <label class="check"><input type="checkbox" name="enabled"> Use TMDB metadata</label>
        <label>TMDB API key or read access token<input type="password" name="apiKey" maxlength="4096" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <p class="note" id="key-hint"></p>
        <label>Metadata language<select name="language"><option value="en">English</option><option value="ru">Русский</option><option value="de">Deutsch</option><option value="uk">Українська</option><option value="fr">Français</option><option value="es">Español</option><option value="it">Italiano</option></select></label>
        <button type="submit">Send settings to TV</button>
        <p class="note">Changes apply only after confirmation on your TV. This link expires in five minutes. When enabled, title searches go directly from the TV to TMDB.</p>`;
    (form.elements.namedItem('layout') as HTMLSelectElement).value =
        defaults.layout;
    (form.elements.namedItem('language') as HTMLSelectElement).value =
        defaults.tmdb.language;
    (form.elements.namedItem('epg') as HTMLInputElement).checked = defaults.epg;
    // A TV from before these switches sends no values and would ignore them.
    const playback = form.querySelector<HTMLElement>('#playback')!;
    playback.hidden =
        defaults.seriesAutoplay === undefined &&
        defaults.playerUpNextCard === undefined;
    for (const field of ['seriesAutoplay', 'playerUpNextCard'] as const) {
        const input = form.elements.namedItem(field) as HTMLInputElement;
        input.checked = defaults[field] !== false;
        input.disabled = playback.hidden;
    }
    const enabled = form.elements.namedItem('enabled') as HTMLInputElement;
    const key = form.elements.namedItem('apiKey') as HTMLInputElement;
    enabled.checked = defaults.tmdb.enabled;
    const required = () => {
        key.required = enabled.checked && !defaults.tmdb.hasKey;
    };
    enabled.onchange = required;
    required();
    form.querySelector('#key-hint')!.textContent = defaults.tmdb.hasKey
        ? 'A key is already saved on the TV. Leave this field empty to keep it, or paste a replacement. The saved key is never sent to this phone.'
        : 'Paste your own TMDB v3 API key or v4 read access token.';
}
