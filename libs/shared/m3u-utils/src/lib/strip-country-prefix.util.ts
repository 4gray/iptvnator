import { splitM3uNameTag } from './m3u-name-tag.util';

/**
 * Strip country / group prefixes from channel names.
 *
 * The rule itself lives in `m3u-name-tag.util.ts`, because series identity
 * and live-variant grouping need the same answer about where a name starts.
 * This module is the display-facing half: it keeps the settings-aware
 * wrapper and the "return the name unchanged when there is no tag"
 * contract the templates rely on.
 *
 * Examples:
 *   "US | CNN"           → "CNN"
 *   "UK - BBC One"       → "BBC One"
 *   "FR|TF1"             → "TF1"
 *   "|DE| ARD"           → "ARD"
 *   "US: CNN"            → "CNN"
 *   "TR:TRT 1 HD"        → "TRT 1 HD"       (no space after the colon)
 *   "ES - A3 - Sports"   → "A3 - Sports"
 *   "Sky - Sports F1"    → "Sky - Sports F1"  (prefix is not a short tag)
 *   "BBC One"            → "BBC One"          (no separator)
 *   "US | "              → "US |"             (stripping would leave nothing)
 */
export function stripCountryPrefix(name: string): string {
    const { tag, title } = splitM3uNameTag(name);
    return tag === null ? name.trim() : title;
}

/**
 * Settings-aware wrapper for display bindings: strips the prefix only when
 * the `stripCountryPrefix` setting is enabled, and normalizes nullish names
 * to an empty string.
 */
export function applyChannelNameStrip(
    name: string | null | undefined,
    enabled: boolean | null | undefined
): string {
    const raw = name ?? '';
    return enabled ? stripCountryPrefix(raw) : raw;
}
