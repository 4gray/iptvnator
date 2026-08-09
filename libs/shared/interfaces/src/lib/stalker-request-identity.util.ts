import {
    buildStalkerSerialCfduid,
    normalizeStalkerSerialNumber,
} from './stalker-identity.utils';

/**
 * User-Agent of a MAG250 set-top box (matches the stalker-to-m3u reference
 * implementation). Sent as both `User-Agent` and `X-User-Agent` on every
 * portal API request — some panels reject requests without it.
 */
export const STALKER_MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';

export interface StalkerIdentityRequestInput {
    macAddress: string;
    params: Record<string, string | number>;
    token?: string;
    serialNumber?: string;
}

export interface StalkerIdentityRequestContext {
    requestParams: Record<string, string | number>;
    headers: Record<string, string>;
    cookieString: string;
    effectiveSerialNumber?: string;
}

/**
 * Builds the portal-facing identity of a Stalker request: the cookie a real
 * STB sends (`mac` + `stb_lang` + `timezone`, plus a serial-derived
 * `__cfduid`), the MAG User-Agent pair, the `SN`/`Authorization` headers, and
 * the serial-number parameter rules (`sn` travels only on `get_profile`).
 *
 * This is the single source of truth for BOTH transports — the Electron main
 * process and the self-hosted PWA's web-backend `/stalker` proxy — so the two
 * cannot drift apart again. The stock server reads the timezone cookie with
 * `new DateTimeZone()`, so it must always be a valid PHP timezone.
 */
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
        'User-Agent': STALKER_MAG_USER_AGENT,
        'X-User-Agent': STALKER_MAG_USER_AGENT,
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
        requestParams['type'] === 'stb' &&
        requestParams['action'] === 'get_profile';

    if (!isProfileRequest) {
        delete requestParams['sn'];
        return requestParams;
    }

    if (effectiveSerialNumber) {
        requestParams['sn'] = effectiveSerialNumber;
    } else {
        delete requestParams['sn'];
    }

    if (typeof requestParams['metrics'] === 'string') {
        try {
            const parsedMetrics = JSON.parse(requestParams['metrics']);
            const nextMetrics = { ...(parsedMetrics ?? {}) };

            if (effectiveSerialNumber) {
                nextMetrics.sn = effectiveSerialNumber;
            } else {
                delete nextMetrics.sn;
            }

            requestParams['metrics'] = JSON.stringify(nextMetrics);
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
