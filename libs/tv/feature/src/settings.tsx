import { BackendConnection } from './backend-connection';
import { DirectAccessProbe } from './direct-probe';
import { TmdbSettings } from './tmdb-settings';
import { TvModel } from './use-tv';
export function Settings({ tv }: { tv: TvModel }) {
    const save = (event: SubmitEvent) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        tv.update((d) => ({
            ...d,
            layout: form.get('layout') === 'shelf' ? 'shelf' : 'cinema',
            epg: form.has('epg'),
        })).catch(() => tv.setError('Settings could not be saved.'));
    };
    return (
        <>
            <h1>Settings</h1>
            <BackendConnection tv={tv} label="Backend URL" />
            <form class="source-form" onSubmit={save}>
                <label>
                    Home composition
                    <select name="layout" defaultValue={tv.data.layout}>
                        <option value="cinema">Кинозал · Cinema</option>
                        <option value="shelf">Витрина · Showcase</option>
                    </select>
                </label>
                <label class="check">
                    <input
                        type="checkbox"
                        name="epg"
                        defaultChecked={tv.data.epg}
                    />{' '}
                    Show provider programme guide
                </label>
                <button class="primary">Save settings</button>
            </form>
            <DirectAccessProbe tv={tv} />
            <TmdbSettings tv={tv} />
            <h2>Your remote</h2>
            <p class="muted">
                Arrows move focus. OK selects. Back returns to your last title.
                <br />
                Live: first OK starts preview; OK again opens fullscreen.
                <br />
                Text fields: Up / Down leaves the field. Select lists: Left /
                Right leaves the list.
                <br />
                Playback: Play / Pause, Rewind and Fast Forward are supported.
            </p>
            <p class="muted">
                Sources, favorites and viewing progress stay on this TV. Native
                media compatibility must be checked on your device.
            </p>
        </>
    );
}
