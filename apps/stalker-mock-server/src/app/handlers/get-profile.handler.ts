import { Request, Response } from 'express';
import {
    adoptToken,
    hasCompletedDoAuth,
    pinDeviceIdentity,
    readBearerToken,
} from '../auth-store.js';
import { getScenario } from '../scenarios.js';
import { extractMac } from '../request-mac.js';

/** `00:1A:79` is the Infomir OUI the stock portal requires by default. */
const INFOMIR_MAC = /^00:1A:79:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}$/;

/**
 * Stalker get_profile — the step that turns a handshake token into a session.
 *
 * Reproduces the outcomes of the 4.9.35 middleware: a bare `{status:1}` for a
 * malformed MAC, `{status:1, msg, block_msg}` for a device conflict,
 * `{status:2}` when the portal wants login/password, and otherwise the profile
 * itself. `signature`, `metrics` and `prehash` are accepted and ignored, which
 * is exactly what the real server does.
 */
export function handleGetProfile(
    req: Request,
    res: Response,
    options: { enforceMacFormat?: boolean } = {}
): void {
    const mac = extractMac(req);
    const scenario = getScenario(mac);

    if (options.enforceMacFormat && !INFOMIR_MAC.test(mac.toUpperCase())) {
        res.json({ js: { status: 1 } });
        return;
    }

    // Gate on the actual do_auth completion, not on auth_second_step. The
    // client now sends `auth_second_step=0` first and `1` only on the retry
    // after do_auth, so a parameter check would happen to work — but it would
    // also silently pass for any client that mislabels its first profile,
    // which is exactly the protocol mistake this scenario exists to catch.
    if (scenario.requiresLogin && !hasCompletedDoAuth(mac)) {
        res.json({
            js: {
                status: 2,
                template: 'auth',
                info: 'Login required',
            },
        });
        return;
    }

    const conflict = pinDeviceIdentity(
        mac,
        String(req.query['device_id'] ?? '') || undefined,
        String(req.query['device_id2'] ?? '') || undefined
    );

    if (conflict) {
        res.json({
            js: {
                status: 1,
                msg: conflict,
                block_msg: 'Your STB is damaged.<br/> Call the provider.',
            },
        });
        return;
    }

    const token = readBearerToken(req);
    if (token) {
        adoptToken(mac, token);
    }

    res.json({
        js: {
            id: '1',
            name: 'Mock STB',
            mac,
            status: 0,
            blocked: '0',
            fname: 'Mock User',
            login: 'mockuser',
            stb_type: String(req.query['stb_type'] ?? ''),
            hd: String(req.query['hd'] ?? '1'),
            // Clients should take their watchdog cadence from these two values
            // rather than hardcoding one.
            watchdog_timeout: 120,
            timeslot: 15,
            tariff_plan_id: '1',
            tariff_expired_date: '2099-12-31',
            locale: 'en',
            default_locale: 'en',
        },
    });
}
