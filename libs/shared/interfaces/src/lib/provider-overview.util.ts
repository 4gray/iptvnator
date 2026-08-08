/**
 * Xtream panels routinely fill editorial text fields with junk — most
 * commonly a season `overview` that holds a bare cover-image URL instead
 * of a description. Rendering that verbatim puts a raw URL on screen, so
 * a value that is nothing but a URL is treated as absent.
 */

/**
 * Trimmed overview text, or `null` when the value is empty or a bare URL.
 * Prose that merely contains a URL is kept — only a single URL token with
 * no surrounding text is junk.
 */
export function sanitizeProviderOverview(
    text: string | null | undefined
): string | null {
    const trimmed = text?.trim();
    if (!trimmed) {
        return null;
    }
    return isBareUrl(trimmed) ? null : trimmed;
}

/** A single absolute or protocol-relative URL token (`http://…/x.jpg`). */
function isBareUrl(text: string): boolean {
    return /^(?:https?:)?\/\/\S+$/i.test(text);
}
