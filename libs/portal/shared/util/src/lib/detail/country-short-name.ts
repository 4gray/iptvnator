/** Short display names for the countries providers spell out in full. */
const SHORT_BY_CODE: Record<string, string> = {
    US: 'USA',
    GB: 'UK',
    AE: 'UAE',
    RU: 'Russia',
    KR: 'South Korea',
    KP: 'North Korea',
    CZ: 'Czechia',
    DE: 'Germany',
    FR: 'France',
    IR: 'Iran',
    SY: 'Syria',
    VN: 'Vietnam',
    TW: 'Taiwan',
    BO: 'Bolivia',
    VE: 'Venezuela',
    TZ: 'Tanzania',
    LA: 'Laos',
    MD: 'Moldova',
    MK: 'North Macedonia',
    CD: 'DR Congo',
    CG: 'Congo',
    FM: 'Micronesia',
    BN: 'Brunei',
    VA: 'Vatican',
};

const SHORT_BY_NAME: Record<string, string> = {
    'united states of america': 'USA',
    'united states': 'USA',
    usa: 'USA',
    'united kingdom': 'UK',
    'great britain': 'UK',
    'united arab emirates': 'UAE',
    'russian federation': 'Russia',
    россия: 'Россия',
    сша: 'США',
    'republic of korea': 'South Korea',
    'korea, republic of': 'South Korea',
    'czech republic': 'Czechia',
    'islamic republic of iran': 'Iran',
    'syrian arab republic': 'Syria',
    'viet nam': 'Vietnam',
    'taiwan, province of china': 'Taiwan',
    'lao people’s democratic republic': 'Laos',
    "lao people's democratic republic": 'Laos',
    'republic of moldova': 'Moldova',
    'the netherlands': 'Netherlands',
    'federal republic of germany': 'Germany',
};

/**
 * "United States of America" → "USA", "GB" → "UK". Unknown names come back
 * trimmed, so the chip never loses a country it cannot shorten.
 */
export function shortCountryName(
    name: string | null | undefined,
    code?: string | null
): string {
    const trimmed = (name ?? '').trim();
    const byCode = code ? SHORT_BY_CODE[code.trim().toUpperCase()] : undefined;
    if (byCode) {
        return byCode;
    }
    const byName = SHORT_BY_NAME[trimmed.toLowerCase()];
    if (byName) {
        return byName;
    }
    return trimmed || (code ?? '').trim().toUpperCase();
}

/** Canonical names that carry a comma themselves ("Korea, Republic of"). */
const COMMA_NAMES = new Set(
    Object.keys(SHORT_BY_NAME).filter((name) => name.includes(','))
);

/** Every country of a provider list, shortened. */
export function shortCountryList(value: string | null | undefined): string[] {
    const parts: string[] = [];
    for (const group of (value ?? '').split(/[;/]/)) {
        parts.push(...splitCommaList(group));
    }
    return parts
        .map((part) => shortCountryName(part))
        .filter((part) => part.length > 0);
}

/** Splits on commas but keeps a known comma-bearing country name whole. */
function splitCommaList(value: string): string[] {
    const segments = value
        .split(',')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
    const parts: string[] = [];
    for (let index = 0; index < segments.length; index++) {
        const joined = `${segments[index]}, ${segments[index + 1] ?? ''}`;
        if (COMMA_NAMES.has(joined.toLowerCase())) {
            parts.push(joined);
            index++;
        } else {
            parts.push(segments[index]);
        }
    }
    return parts;
}
