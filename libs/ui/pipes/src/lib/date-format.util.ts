const DEFAULT_DATE_LOCALE = 'en';

const DATE_LOCALE_ALIASES: Record<string, string> = {
    ary: 'ar-MA',
    by: 'be',
    zhtw: 'zh-Hant',
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function normalizeDateLocale(locale?: string | null): string {
    const normalizedLocale = String(locale ?? '').trim();

    if (!normalizedLocale) {
        return DEFAULT_DATE_LOCALE;
    }

    return (
        DATE_LOCALE_ALIASES[normalizedLocale.toLowerCase()] ?? normalizedLocale
    );
}

export function formatWithIntl(
    value: Date | number | string,
    options: Intl.DateTimeFormatOptions & {
        locale?: string | null;
        timeZone?: string;
    } = {}
): string {
    const date =
        value instanceof Date
            ? value
            : typeof value === 'number'
              ? new Date(value)
              : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const { locale, ...formatOptions } = options;
    const resolvedLocale = normalizeDateLocale(locale);
    const cacheKey = JSON.stringify([resolvedLocale, formatOptions]);

    let formatter = formatterCache.get(cacheKey);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(resolvedLocale, formatOptions);
        formatterCache.set(cacheKey, formatter);
    }

    return formatter.format(date);
}
