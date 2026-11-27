import { findM3uTagSeparator } from './m3u-name-tag.util';

export interface M3uNameTagSplit {
    /** The stripped tag, or null when the name carries none. */
    readonly tag: string | null;
    /** The name with the tag removed, or the original when there is none. */
    readonly title: string;
}

/**
 * Finds the first tag separator and splits there.
 *
 * Only the leading tag is removed: if the separator appears again, the rest
 * of the name keeps it (`ES - K3 - Sports` → `K3 - Sports`). A split that
 * would leave nothing behind reports no tag, so a name that is only a tag
 * survives unchanged.
 *
 * The series layer needs the tag as well as the title, so this lives behind
 * the series entry point; `stripCountryPrefix` is the title-only twin the
 * startup path uses, and both split where `findM3uTagSeparator` says.
 */
export function splitM3uNameTag(
    name: string | null | undefined
): M3uNameTagSplit {
    const trimmed = (name ?? '').trim();
    const match = trimmed ? findM3uTagSeparator(trimmed) : null;
    const rest = match ? trimmed.slice(match.index + match.length).trim() : '';
    if (!match || !rest) {
        return { tag: null, title: trimmed };
    }

    // A wrapped tag ("|DE| Kanal") opens with the separator, so the first
    // split yields an empty prefix; the tag is in what follows.
    const tag = trimmed.slice(0, match.index).trim();
    return tag ? { tag, title: rest } : splitM3uNameTag(rest);
}
