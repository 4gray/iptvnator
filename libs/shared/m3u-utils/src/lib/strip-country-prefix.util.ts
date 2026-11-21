import { findM3uTagSeparator } from './m3u-name-tag.util';

/**
 * Strip country / group prefixes from channel names.
 *
 * The rule itself (`findM3uTagSeparator`) lives in `m3u-name-tag.util.ts`,
 * because series identity needs the same answer about where a name starts
 * (`splitM3uNameTag`, behind the series entry point). This module is the
 * display-facing half, kept as small as the startup path needs: the
 * settings-aware wrapper and the "return the name unchanged when there is
 * no tag" contract the templates rely on.
 *
 * Examples:
 *   "US | CNN"           → "CNN"
 *   "UK - BBC One"       → "BBC One"
 *   "FR|TF1"             → "TF1"
 *   "|DE| ARD"           → "ARD"
 *   "| Globe News"       → "Globe News"
 *   "US: CNN"            → "CNN"
 *   "TR:KANAL 1 HD"      → "KANAL 1 HD"     (no space after the colon)
 *   "ES - A3 - Sports"   → "A3 - Sports"
 *   "Sky - Sports F1"    → "Sky - Sports F1"  (prefix is not a short tag)
 *   "BBC One"            → "BBC One"          (no separator)
 *   "US | "              → "US |"             (stripping would leave nothing)
 */
export function stripCountryPrefix(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;

    const match = findM3uTagSeparator(trimmed);
    if (!match) return trimmed;

    const prefix = trimmed.slice(0, match.index).trim();
    const stripped = trimmed.slice(match.index + match.length).trim();
    if (!stripped) return trimmed;

    // A bare leading separator ("| Globe News") carries no tag; what follows
    // may still carry one ("|DE| Kanal").
    return prefix ? stripped : stripCountryPrefix(stripped);
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
