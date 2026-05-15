import {
    buildStalkerSerialCfduid,
    LEGACY_DEFAULT_STALKER_SERIAL,
    normalizeStalkerSerialNumber,
} from '@iptvnator/shared/interfaces';

export { LEGACY_DEFAULT_STALKER_SERIAL };

interface StalkerIdentityRequestInput {
    macAddress: string;
    params: Record<string, string | number>;
    token?: string;
    serialNumber?: string;
}

interface StalkerIdentityRequestContext {
    requestParams: Record<string, string | number>;
    headers: Record<string, string>;
    cookieString: string;
    effectiveSerialNumber?: string;
}

export function buildStalkerIdentityRequestContext({
    macAddress,
    params,
    token,
    serialNumber,
}: StalkerIdentityRequestInput): StalkerIdentityRequestContext {
    const effectiveSerialNumber = normalizeStalkerSerialNumber(serialNumber);
    const requestParams = buildRequestParams(params, effectiveSerialNumber);
    const cookieString = buildCookieString(macAddress, effectiveSerialNumber);
    const headers: Record<string, string> = {
        Cookie: cookieString,
        // Use MAG250 User-Agent matching stalker-to-m3u implementation
        'User-Agent':
            'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
        'X-User-Agent':
            'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
        Accept: '*/*',
        Connection: 'keep-alive',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    if (effectiveSerialNumber) {
        headers['SN'] = effectiveSerialNumber;
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return {
        requestParams,
        headers,
        cookieString,
        ...(effectiveSerialNumber ? { effectiveSerialNumber } : {}),
    };
}

function buildRequestParams(
    params: Record<string, string | number>,
    effectiveSerialNumber: string | undefined
): Record<string, string | number> {
    const requestParams = { ...params };
    const isProfileRequest =
        requestParams.type === 'stb' &&
        requestParams.action === 'get_profile';

    if (!isProfileRequest) {
        delete requestParams.sn;
        return requestParams;
    }

    if (effectiveSerialNumber) {
        requestParams.sn = effectiveSerialNumber;
    } else {
        delete requestParams.sn;
    }

    if (typeof requestParams.metrics === 'string') {
        try {
            const parsedMetrics = JSON.parse(requestParams.metrics);
            const nextMetrics = { ...(parsedMetrics ?? {}) };

            if (effectiveSerialNumber) {
                nextMetrics.sn = effectiveSerialNumber;
            } else {
                delete nextMetrics.sn;
            }

            requestParams.metrics = JSON.stringify(nextMetrics);
        } catch {
            // Keep original metrics payload when malformed.
        }
    }

    return requestParams;
}

function buildCookieString(
    macAddress: string,
    effectiveSerialNumber: string | undefined
): string {
    const cookieParts = [
        `mac=${macAddress}`,
        'stb_lang=en_US@rg=dezzzz',
        'timezone=Europe/Berlin',
    ];

    if (effectiveSerialNumber) {
        cookieParts.push(
            `__cfduid=${buildStalkerSerialCfduid(effectiveSerialNumber)}`
        );
    }

    return cookieParts.join('; ');
}
