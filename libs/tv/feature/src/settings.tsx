import { useState } from 'preact/hooks';
import { LibrarySettings } from './library-settings';
import { PhoneSetup } from './phone-setup';
import { BackendConnection } from './backend-connection';
import { DirectAccessProbe } from './direct-probe';
import { TmdbSettings } from './tmdb-settings';
import { SettingsPreferences } from './settings-preferences';
import {
    settingsCategories,
    SettingsMemory,
    useSettingsNavigation,
} from './settings-navigation';
import type { TvModel } from './use-tv';

export function Settings({
    tv,
    memory,
}: {
    tv: TvModel;
    memory: SettingsMemory;
}) {
    const navigation = useSettingsNavigation(memory);
    const [phoneRevision, setPhoneRevision] = useState(0);
    return (
        <div
            class="settings-screen"
            ref={navigation.root}
            onFocusCapture={navigation.onFocus}
            onKeyDown={navigation.onKeyDown}
        >
            <div class="settings-toolbar">
                <p class="muted">Choose a category to adjust settings.</p>
                <PhoneSetup
                    tv={tv}
                    purpose="settings"
                    compact
                    onSettingsApplied={() =>
                        setPhoneRevision((value) => value + 1)
                    }
                />
            </div>
            <div class="settings-workspace">
                <div
                    class="settings-categories"
                    role="tablist"
                    aria-label="Settings categories"
                    aria-orientation="vertical"
                >
                    {settingsCategories.map(([id, title, subtitle]) => (
                        <button
                            key={id}
                            id={`settings-tab-${id}`}
                            role="tab"
                            aria-selected={navigation.category === id}
                            aria-controls={`settings-panel-${id}`}
                            data-focus={`settings:${id}`}
                            onFocus={() => navigation.select(id)}
                            onClick={() => navigation.select(id)}
                        >
                            <span id={`settings-label-${id}`}>{title}</span>
                            <small>{subtitle}</small>
                        </button>
                    ))}
                </div>
                {settingsCategories.map(([id]) => (
                    <div
                        key={id}
                        id={`settings-panel-${id}`}
                        role="tabpanel"
                        aria-labelledby={`settings-label-${id}`}
                        data-settings-panel
                        tabIndex={-1}
                        data-focus={`settings-panel:${id}`}
                        hidden={navigation.category !== id}
                        onScroll={(event) => {
                            memory.scroll[id] = event.currentTarget.scrollTop;
                        }}
                    >
                        {id === 'connection' ? (
                            <>
                                <BackendConnection
                                    tv={tv}
                                    label="Backend URL"
                                />
                                <DirectAccessProbe tv={tv} />
                            </>
                        ) : id === 'library' ? (
                            <LibrarySettings tv={tv} />
                        ) : id === 'appearance' ? (
                            <SettingsPreferences
                                key={`layout:${phoneRevision}`}
                                tv={tv}
                                field="layout"
                            />
                        ) : id === 'epg' ? (
                            <SettingsPreferences
                                key={`epg:${phoneRevision}`}
                                tv={tv}
                                field="epg"
                            />
                        ) : id === 'metadata' ? (
                            <TmdbSettings
                                key={`tmdb:${phoneRevision}`}
                                tv={tv}
                            />
                        ) : (
                            <>
                                <h2>Your remote</h2>
                                <p class="muted">
                                    Arrows move focus. OK selects. Back returns
                                    to categories, then to your last title.
                                </p>
                                <p class="muted">
                                    Right or OK opens a category. Left returns
                                    to categories. Text fields keep Left / Right
                                    for the caret; Up / Down leaves the field.
                                    Select lists keep Up / Down for choices.
                                </p>
                                <p class="muted">
                                    Live: first OK starts preview; OK again
                                    opens fullscreen. Playback: Play / Pause,
                                    Rewind and Fast Forward are supported.
                                </p>
                                <p class="muted">
                                    Favorites and viewing progress stay on this
                                    TV. Native media compatibility must be
                                    checked on your device.
                                </p>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
