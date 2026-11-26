import { runInNewContext } from 'node:vm';
import {
    HOSTED_BROWSER_TOKEN_PREFIX,
    SOURCE_SERVER_CONNECTION_KEY,
    SOURCE_SERVER_DISABLED_KEY,
} from '@iptvnator/shared/interfaces';
import express from 'express';
import { JSDOM } from 'jsdom';
import { withServer } from './web-backend-app.spec-helpers';
import { mountHostedCloudflareDevicePage } from './hosted-cloudflare-device-page';

describe('Cloudflare browser invitations', () => {
    const origin = 'https://library.example.test';
    const instance = 'invited-instance';
    const invite = 'A'.repeat(43);
    const connection = { apiUrl: origin + '/api', instanceId: instance };
    let html: string;
    let script: string;

    beforeAll(async () => {
        const app = express();
        mountHostedCloudflareDevicePage(app);
        await withServer(app, async (base, send) => {
            html = await (await send(base + '/connect-device.html')).text();
            script = await (await send(base + '/connect-device.js')).text();
        });
    });

    function open() {
        const { window } = new JSDOM(html, {
            url:
                origin +
                '/connect-device.html#iptvnator-access=' +
                instance +
                '&invite=' +
                invite,
        });
        const storage = window.localStorage;
        storage.setItem(SOURCE_SERVER_DISABLED_KEY, JSON.stringify(connection));
        const fetch = jest.fn();
        const replace = jest.fn();
        runInNewContext(script, {
            document: window.document,
            history: window.history,
            localStorage: storage,
            location: {
                origin,
                pathname: window.location.pathname,
                hash: window.location.hash,
                replace,
            },
            URLSearchParams,
            fetch,
        });
        const button = window.document.querySelector('button');
        if (!button) throw new Error('Missing connect button');
        return { window, button, storage, fetch, replace };
    }

    it('selects the invited server again after registration and preserves other scoped credentials', async () => {
        const { window, button, storage, fetch, replace } = open();
        const otherToken = HOSTED_BROWSER_TOKEN_PREFIX + 'other-instance';
        storage.setItem(otherToken, 'synthetic-other-token');
        expect(fetch).not.toHaveBeenCalled();
        expect(storage.getItem(SOURCE_SERVER_DISABLED_KEY)).toBe(
            JSON.stringify(connection)
        );
        fetch.mockResolvedValue(new Response(null, { status: 204 }));
        button.click();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/device-pairing/cloudflare',
            {
                method: 'POST',
                redirect: 'error',
                headers: {
                    'Content-Type': 'application/json',
                    'X-IPTVnator-Instance-Id': instance,
                },
                body: JSON.stringify({ inviteId: invite, name: 'Web browser' }),
            }
        );
        expect(storage.getItem(SOURCE_SERVER_CONNECTION_KEY)).toBe(
            JSON.stringify(connection)
        );
        expect(storage.getItem(SOURCE_SERVER_DISABLED_KEY)).toBeNull();
        expect(storage.getItem(otherToken)).toBe('synthetic-other-token');
        expect(storage.length).toBe(2);
        expect(replace).toHaveBeenCalledWith('/');
        window.close();
    });

    it('allows a retry if the browser cannot save the connection', async () => {
        const { window, button, storage, fetch, replace } = open();
        jest.spyOn(window.Storage.prototype, 'setItem').mockImplementation(
            () => {
                throw new Error('Storage unavailable');
            }
        );
        fetch.mockResolvedValue(new Response(null, { status: 204 }));
        button.click();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(storage.getItem(SOURCE_SERVER_DISABLED_KEY)).toBe(
            JSON.stringify(connection)
        );
        expect(storage.getItem(SOURCE_SERVER_CONNECTION_KEY)).toBeNull();
        expect(replace).not.toHaveBeenCalled();
        expect(button.disabled).toBe(false);
        expect(window.document.getElementById('status')?.textContent).toContain(
            'save browser data'
        );
        window.close();
    });

    it.each([403, 409, 200])(
        'preserves the disconnected selection on registration response %i',
        async (status) => {
            const { window, button, storage, fetch, replace } = open();
            fetch.mockResolvedValue(new Response(null, { status }));
            button.click();
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(storage.getItem(SOURCE_SERVER_DISABLED_KEY)).toBe(
                JSON.stringify(connection)
            );
            expect(storage.getItem(SOURCE_SERVER_CONNECTION_KEY)).toBeNull();
            expect(replace).not.toHaveBeenCalled();
            window.close();
        }
    );
});
