type RequestOriginSource = {
    protocol: string;
    get(name: string): string | undefined;
};

/** Posters and channel logos alike: every asset this process serves itself. */
const MARKETING_POSTER_PATH_PREFIX = '/assets/marketing/';

export function buildRequestOrigin(request: RequestOriginSource): string {
    const protocol =
        firstForwardedValue(request.get('x-forwarded-proto')) ??
        request.protocol;
    const host =
        firstForwardedValue(request.get('x-forwarded-host')) ??
        request.get('host');

    return host ? `${protocol}://${host}` : '';
}

export function resolveMarketingPosterUrls(
    payload: unknown,
    origin: string
): unknown {
    if (
        typeof payload === 'string' &&
        payload.startsWith(MARKETING_POSTER_PATH_PREFIX)
    ) {
        return origin ? new URL(payload, origin).href : payload;
    }

    if (Array.isArray(payload)) {
        return payload.map((item) => resolveMarketingPosterUrls(item, origin));
    }

    if (payload && typeof payload === 'object') {
        return Object.fromEntries(
            Object.entries(payload).map(([key, value]) => [
                key,
                resolveMarketingPosterUrls(value, origin),
            ])
        );
    }

    return payload;
}

function firstForwardedValue(value: string | undefined): string | undefined {
    return value
        ?.split(',', 1)[0]
        ?.trim()
        .replace(/^(?:https?):\/\//, '');
}
