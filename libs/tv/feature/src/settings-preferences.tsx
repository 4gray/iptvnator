import { TvSelect } from '@iptvnator/tv/ui';
import { useEffect, useState } from 'preact/hooks';
import type { TvModel } from './use-tv';

const copy = {
    layout: {
        title: 'Appearance',
        description: 'Choose how titles appear on Home.',
        label: 'Home composition',
    },
    epg: {
        title: 'Programme guide',
        description: 'Show programme information supplied by your TV provider.',
        label: 'Show provider programme guide',
    },
    seriesAutoplay: {
        title: 'Playback',
        description:
            'When an episode ends, the next one plays. Up next counts down to it near the end.',
        label: 'Autoplay next episode',
    },
} as const;

// Each form owns one persisted field. Saving one category must never commit
// another category's draft, including after a phone settings update.
export function SettingsPreferences({
    tv,
    field,
}: {
    tv: TvModel;
    field: 'layout' | 'epg' | 'seriesAutoplay';
}) {
    const persisted = tv.data[field];
    const [value, setValue] = useState(persisted);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setValue(persisted);
    }, [persisted]);
    const save = (event: SubmitEvent) => {
        event.preventDefault();
        const draft = value;
        const persist = async () => {
            setSaving(true);
            try {
                await tv.update((data) =>
                    field === 'layout'
                        ? {
                              ...data,
                              layout: draft === 'shelf' ? 'shelf' : 'cinema',
                          }
                        : { ...data, [field]: draft === true }
                );
                setSaved(true);
                tv.setError('');
            } catch {
                tv.setError(
                    'Settings could not be saved.',
                    () => void persist(),
                    'Retry saving settings'
                );
            } finally {
                setSaving(false);
            }
        };
        setSaved(false);
        void persist();
    };
    return (
        <form class="source-form" onSubmit={save}>
            <h2>{copy[field].title}</h2>
            <p class="muted">{copy[field].description}</p>
            {field === 'layout' ? (
                <label>
                    Home composition
                    <TvSelect
                        label="Home composition"
                        focusKey="settings:layout:value"
                        value={String(value)}
                        options={[
                            { value: 'cinema', label: 'Кинозал · Cinema' },
                            { value: 'shelf', label: 'Витрина · Showcase' },
                        ]}
                        onChange={(next) => {
                            setValue(next === 'shelf' ? 'shelf' : 'cinema');
                            setSaved(false);
                        }}
                    />
                </label>
            ) : (
                <label class="check">
                    <input
                        type="checkbox"
                        name={field}
                        data-focus={`settings:${field}:value`}
                        checked={value === true}
                        onChange={(event) => {
                            setValue(event.currentTarget.checked);
                            setSaved(false);
                        }}
                    />
                    {copy[field].label}
                </label>
            )}
            <button
                class="primary"
                disabled={saving}
                data-focus={`settings:${field}:save`}
            >
                {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saved ? <p role="status">Settings saved on this TV.</p> : null}
        </form>
    );
}
