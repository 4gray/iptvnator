/** Existing conservative key used by name recovery. */
export function normalizeEpgName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/\b(?:hd|fhd|uhd|4k)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/**
 * More permissive fallback key. Strip only a recognized terminal quality
 * marker, then remove separators while retaining letters and channel numbers.
 */
export function normalizeEpgNameFlexibly(value: string): string {
    const withoutQualitySuffix = value.replace(
        /(?:[\s._:/-]*)(?:full[\s._-]*hd|fhd|uhd|4k|hd\+?|sd)$/i,
        ''
    );
    return withoutQualitySuffix
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}
