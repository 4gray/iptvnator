import { TvSelect } from '@iptvnator/tv/ui';
import type { UserData } from '@iptvnator/tv/util';
import { useEffect, useState } from 'preact/hooks';
import type { TvModel } from './use-tv';

type Toggle = 'epg' | 'seriesAutoplay' | 'playerUpNextCard';
type Category = 'layout' | 'epg' | 'playback';
type Values = Partial<Pick<UserData, 'layout' | Toggle>>;

const copy: Record<
    Category,
    {
        title: string;
        description: string;
        toggles: { field: Toggle; label: string }[];
    }
> = {
    layout: {
        title: 'Appearance',
        description: 'Choose how titles appear on Home.',
        toggles: [],
    },
    epg: {
        title: 'Programme guide',
        description: 'Show programme information supplied by your TV provider.',
        toggles: [{ field: 'epg', label: 'Show provider programme guide' }],
    },
    playback: {
        title: 'Playback',
        description:
            'When an episode ends, the next one plays. The Up next card shows it shortly before the end.',
        // Same names, labels and defaults as the desktop and web settings.
        toggles: [
            { field: 'seriesAutoplay', label: 'Autoplay next episode' },
            { field: 'playerUpNextCard', label: '"Up next" card' },
        ],
    },
};

/** The category's switches, read through `value` (no Object.fromEntries on TV). */
function toggleValues(
    category: Category,
    value: (field: Toggle) => boolean
): Values {
    const values: Values = {};
    for (const { field } of copy[category].toggles)
        values[field] = value(field);
    return values;
}

function persistedValues(data: UserData, category: Category): Values {
    if (category === 'layout') return { layout: data.layout };
    return toggleValues(category, (field) => data[field]);
}

// Each form owns its category's persisted fields. Saving one category must
// never commit another category's draft, including after a phone settings
// update.
export function SettingsPreferences({
    tv,
    category,
}: {
    tv: TvModel;
    category: Category;
}) {
    const persisted = persistedValues(tv.data, category);
    const persistedKey = JSON.stringify(persisted);
    const [values, setValues] = useState<Values>(persisted);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setValues(persisted);
    }, [persistedKey]);
    const change = (next: Values) => {
        setValues((current) => ({ ...current, ...next }));
        setSaved(false);
    };
    const save = (event: SubmitEvent) => {
        event.preventDefault();
        const draft = values;
        const persist = async () => {
            setSaving(true);
            try {
                await tv.update((data) =>
                    category === 'layout'
                        ? {
                              ...data,
                              layout:
                                  draft.layout === 'shelf' ? 'shelf' : 'cinema',
                          }
                        : {
                              ...data,
                              ...toggleValues(
                                  category,
                                  (field) => draft[field] === true
                              ),
                          }
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
            <h2>{copy[category].title}</h2>
            <p class="muted">{copy[category].description}</p>
            {category === 'layout' ? (
                <label>
                    Home composition
                    <TvSelect
                        label="Home composition"
                        focusKey="settings:layout:value"
                        value={String(values.layout)}
                        options={[
                            { value: 'cinema', label: 'Кинозал · Cinema' },
                            { value: 'shelf', label: 'Витрина · Showcase' },
                        ]}
                        onChange={(next) =>
                            change({
                                layout: next === 'shelf' ? 'shelf' : 'cinema',
                            })
                        }
                    />
                </label>
            ) : (
                copy[category].toggles.map(({ field, label }) => (
                    <label class="check" key={field}>
                        <input
                            type="checkbox"
                            name={field}
                            data-focus={`settings:${field}:value`}
                            checked={values[field] === true}
                            onChange={(event) =>
                                change({ [field]: event.currentTarget.checked })
                            }
                        />
                        {label}
                    </label>
                ))
            )}
            <button
                class="primary"
                disabled={saving}
                data-focus={`settings:${category}:save`}
            >
                {saving ? 'Saving…' : 'Save settings'}
            </button>
            {saved ? <p role="status">Settings saved on this TV.</p> : null}
        </form>
    );
}
