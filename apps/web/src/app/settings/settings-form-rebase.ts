import { normalizeAgeRatingCountry } from '@iptvnator/shared/interfaces/age-rating';
import { epgSourceReferenceIdentity } from '@iptvnator/services/playlist-backup';
import type { Settings } from '@iptvnator/shared/interfaces';
import { epgSourceUrlsChanged } from '@iptvnator/services';
import { diffSettingsValues } from './settings-change-tracking';
import { SettingsForm } from './settings-form.utils';
import { normalizeSavedAppearance } from './settings-theme-preview';

export type SettingsFormValue = ReturnType<SettingsForm['getRawValue']>;

export interface SettingsFormSubmission {
    paths: readonly string[];
    snapshot: SettingsFormValue;
    baseline: SettingsFormValue;
}

type Values = Record<string, unknown>;

/**
 * Groups the store merges into its current value itself. Every other group
 * goes out complete, since the store default-fills a partial one.
 */
const STORE_MERGED_GROUPS = new Set(['tmdb']);

/**
 * The part of `settings` (built from the whole form) that the user changed:
 * only the top-level keys named by `changedPaths`. A changed leaf of a
 * nested group goes out over the group as stored now, so a sibling changed
 * outside the form keeps its value. Everything else is left to the store,
 * which keeps what other surfaces wrote while the page was open.
 */
export function pickChangedSettings(
    settings: Settings,
    changedPaths: readonly string[],
    stored: Settings
): Partial<Settings> {
    const source = settings as unknown as Values;
    const current = stored as unknown as Values;
    const patch: Values = {};
    for (const path of changedPaths) {
        const [key, leaf] = path.split('.');
        if (!(key in source)) continue;
        if (leaf === undefined) {
            patch[key] = source[key];
            continue;
        }
        const group = (patch[key] ??
            (STORE_MERGED_GROUPS.has(key)
                ? {}
                : {
                      ...((current[key] as Values | undefined) ?? {}),
                  })) as Values;
        group[leaf] = (source[key] as Values | undefined)?.[leaf];
        patch[key] = group;
    }
    return patch as Partial<Settings>;
}

/**
 * What the form would show after `hydrateFromStore()` for these settings,
 * computed without touching the form: a control takes the stored value when
 * the settings carry its key (a group, each leaf it carries). EPG sources are
 * trimmed and blank rows dropped. Missing settings keep the saved baseline.
 */
export function settingsToFormValue(
    settings: Settings,
    saved: SettingsFormValue
): SettingsFormValue {
    const stored: Values = {
        ...settings,
        ...normalizeSavedAppearance(settings),
    };
    const next: Values = { ...(saved as unknown as Values) };
    for (const key of Object.keys(next)) {
        if (!(key in stored)) continue;
        const value = stored[key];
        const shape = next[key];
        if (key === 'epgUrl') {
            if (value) next[key] = normalizeFormEpgUrls(value);
        } else if (isGroup(shape)) {
            if (isGroup(value)) next[key] = mergeLeaves(shape, value);
        } else {
            next[key] = value;
        }
    }
    if ('ageRatingCountry' in stored) {
        next['ageRatingCountry'] = normalizeAgeRatingCountry(
            settings.ageRatingCountry
        );
    }
    return next as unknown as SettingsFormValue;
}

/** Adopts settings with committed EPG sources while identifying each draft. */
export function rebaseSettingsForm(
    current: SettingsFormValue,
    saved: SettingsFormValue,
    stored: Settings,
    unsettledPaths: ReadonlySet<string>,
    ownEpgUrls: unknown[],
    context: {
        submitted?: SettingsFormSubmission;
        pendingEpgUrls?: readonly (string | null)[];
        persistedEpgSources?: readonly (string | null)[];
        confirmedTmdbKey?: string;
    }
): {
    next: SettingsFormValue;
    staged: ReadonlySet<string>;
    addedEpgUrls: string[];
} {
    const { submitted, pendingEpgUrls, confirmedTmdbKey } = context;
    const next = settingsToFormValue(stored, saved);
    const staged = new Set(diffSettingsValues(current, saved));
    if (submitted) {
        const laterEdits = new Set(
            diffSettingsValues(current, submitted.snapshot)
        );
        for (const path of submitted.paths) {
            // An intervening rebase can change what the viewer sees as saved.
            // An edit can then look identical to the original submission.
            const baselineChanged =
                (path === 'epgUrl' &&
                    saved.epgUrl !== submitted.baseline.epgUrl) ||
                (path === 'tmdb.apiKey' &&
                    saved.tmdb.apiKey !== submitted.baseline.tmdb.apiKey);
            if (laterEdits.has(path) || (baselineChanged && staged.has(path)))
                staged.add(path);
            else staged.delete(path);
        }
    } else {
        // A playlist-only import can finish after a rejected key write.
        next.tmdb = {
            ...next.tmdb,
            apiKey: confirmedTmdbKey ?? saved.tmdb.apiKey,
        };
        // Backup import may race an unfinished save. Keep its draft staged
        // while adopting the restored EPG list in the baseline.
        for (const path of unsettledPaths) {
            if (path !== 'epgUrl')
                writeSettingsPath(next, path, readSettingsPath(saved, path));
            staged.add(path);
        }
    }
    const addedEpgUrls = staged.has('epgUrl')
        ? epgUrlsAddedOutside(current.epgUrl, ownEpgUrls, next.epgUrl)
        : [];
    if (staged.has('epgUrl')) {
        const draft = [
            ...normalizeFormEpgUrls(current.epgUrl),
            ...addedEpgUrls,
        ];
        const storedUrls = normalizeFormEpgUrls(next.epgUrl);
        const restoredListChanged =
            !submitted &&
            diffSettingsValues(storedUrls, normalizeFormEpgUrls(saved.epgUrl))
                .length > 0;
        // An imported list keeps its saved spelling and order when its
        // sources already satisfy the draft. Save acknowledgements preserve
        // a later edit to the order or spelling of that list.
        const adoptRestoredOrder =
            restoredListChanged &&
            !epgSourceOrderChanged(
                current.epgUrl,
                context.persistedEpgSources ?? saved.epgUrl
            ) &&
            !epgSourceOrderChanged(current.epgUrl, pendingEpgUrls);
        const matchesSaved = adoptRestoredOrder
            ? !epgSourceUrlsChanged(
                  draft.map(epgSourceReferenceIdentity),
                  storedUrls.map(epgSourceReferenceIdentity)
              )
            : diffSettingsValues(draft, storedUrls).length === 0;
        if (matchesSaved) {
            staged.delete('epgUrl');
            return { next, staged, addedEpgUrls: [] };
        }
    }
    return { next, staged, addedEpgUrls };
}

/** Reads a dotted settings path (`dashboardRails.hero`). */
export function readSettingsPath(value: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (node, key) => (isGroup(node) ? node[key] : undefined),
            value
        );
}

/** Writes a dotted settings path in place. */
export function writeSettingsPath(
    value: SettingsFormValue,
    path: string,
    leafValue: unknown
): void {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let node = value as unknown as Values;
    for (const key of keys) {
        node[key] = { ...((node[key] as Values | undefined) ?? {}) };
        node = node[key] as Values;
    }
    node[last] = leafValue;
}

/**
 * EPG sources that arrived in the saved list from outside the form (a
 * restored backup), so a staged list can take
 * them in instead of dropping them on the next Save.
 */
export function epgUrlsAddedOutside(
    staged: unknown,
    previous: unknown,
    next: unknown
): string[] {
    const known = new Set(
        [
            ...normalizeFormEpgUrls(staged),
            ...normalizeFormEpgUrls(previous),
        ].map(epgSourceReferenceIdentity)
    );
    const added: string[] = [];
    for (const url of normalizeFormEpgUrls(next)) {
        const identity = epgSourceReferenceIdentity(url);
        if (known.has(identity)) continue;
        known.add(identity);
        added.push(url);
    }
    return added;
}

function normalizeFormEpgUrls(value: unknown): string[] {
    const urls = Array.isArray(value) ? value : [value];
    return urls
        .filter((url): url is string => typeof url === 'string')
        .map((url) => url.trim())
        .filter((url) => url !== '');
}

/** Compares the relative order of sources present in both lists. */
function epgSourceOrderChanged(current: unknown, previous: unknown): boolean {
    const currentIds = new Set(
        normalizeFormEpgUrls(current).map(epgSourceReferenceIdentity)
    );
    const previousIds = new Set(
        normalizeFormEpgUrls(previous).map(epgSourceReferenceIdentity)
    );
    return (
        diffSettingsValues(
            [...currentIds].filter((id) => previousIds.has(id)),
            [...previousIds].filter((id) => currentIds.has(id))
        ).length > 0
    );
}

function mergeLeaves(shape: Values, value: Values): Values {
    const merged = { ...shape };
    for (const leaf of Object.keys(shape)) {
        if (leaf in value) merged[leaf] = value[leaf];
    }
    return merged;
}

function isGroup(value: unknown): value is Values {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
