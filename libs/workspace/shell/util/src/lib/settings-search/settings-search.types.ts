/**
 * Runtime capabilities a settings row can depend on. The settings search
 * index must hide rows the settings page itself never renders on this
 * runtime, otherwise search would "find" settings the user cannot reach.
 */
export type SettingsSearchRequirement =
    | 'desktop'
    | 'epg'
    | 'remote-control'
    | 'startup-window-mode'
    | 'portal-connectivity-guard'
    | 'managed-external-players'
    | 'external-player-paths'
    | 'vod-multi-source'
    /** Probed lazily; false until `ensureEmbeddedMpvSupportLoaded` resolves. */
    | 'embedded-mpv'
    | 'embedded-mpv-frame-copy';

export type SettingsSearchCapabilities = Readonly<
    Record<SettingsSearchRequirement, boolean>
>;

/** One routed settings section page (`/workspace/settings/:id`). */
export interface SettingsSectionDefinition {
    readonly id: string;
    /** Short label used by the section navigation. */
    readonly navLabelKey: string;
    readonly icon: string;
    readonly requires?: readonly SettingsSearchRequirement[];
}

/**
 * One searchable settings row. `id` is also the row's `data-setting-id`
 * anchor on the settings page, which is how a search result scrolls to and
 * highlights the row.
 */
export interface SettingsSearchEntry {
    readonly id: string;
    readonly section: string;
    readonly labelKey: string;
    readonly descriptionKey?: string;
    /**
     * Untranslated synonyms. They are matched in addition to the translated
     * label and description, so English terms ("dark", "mpv", "subtitles")
     * keep working under every UI language.
     */
    readonly keywords?: readonly string[];
    readonly requires?: readonly SettingsSearchRequirement[];
    /**
     * Row to reveal when this one is not rendered for the current form
     * state, e.g. the VLC path row while another player is selected: the
     * user lands on the control that makes the searched row appear.
     */
    readonly fallbackId?: string;
}

/** A matched entry with its translated texts, ready to render. */
export interface SettingsSearchResult {
    readonly entry: SettingsSearchEntry;
    readonly section: SettingsSectionDefinition;
    readonly label: string;
    readonly description: string;
    readonly sectionLabel: string;
    readonly score: number;
}

/** Pending "scroll to and highlight this row" request for the settings page. */
export interface SettingsRevealRequest {
    readonly id: string;
    readonly section: string;
    readonly fallbackId?: string;
    /** Distinguishes repeated requests for the same row. */
    readonly nonce: number;
}
