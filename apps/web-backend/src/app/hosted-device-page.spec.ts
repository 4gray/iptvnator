import express from 'express';
import { JSDOM } from 'jsdom';
import { mountHostedDevicePage } from './hosted-device-page';
import { withServer } from './web-backend-app.spec-helpers';

describe('hosted browser invitation', () => {
    let html: string;
    let script: string;
    const invite = 'A'.repeat(43);
    beforeAll(async () => {
        const app = express();
        mountHostedDevicePage(app);
        await withServer(app, async (origin, send) => {
            const page = await send(origin + '/pair-device');
            expect(page.headers.get('content-security-policy')).toContain(
                "connect-src 'self'"
            );
            html = await page.text();
            script = await (await send(origin + '/pair-device.js')).text();
        });
    });

    function open(fragment: string) {
        const { window } = new JSDOM(html, {
            url: 'https://host.example.test/pair-device#' + fragment,
            runScripts: 'outside-only',
        });
        const fetch = jest.fn();
        window.fetch = fetch;
        window.eval(script);
        return {
            window,
            fetch,
            button: window.document.querySelector<HTMLButtonElement>(
                '#pair-browser'
            )!,
            status: window.document.querySelector('[role=status]')!,
        };
    }

    it('removes the invitation from history without claiming it for a link preview or Android', () => {
        const { window, button, fetch } = open(invite);
        expect(window.location.hash).toBe('');
        expect(button.hidden).toBe(false);
        const deepLink =
            window.document.querySelector<HTMLAnchorElement>(
                '#open-iptvnator'
            )!;
        expect(new URL(deepLink.href).searchParams.get('invite')).toBe(invite);
        expect(fetch).not.toHaveBeenCalled();
        expect(window.localStorage.length).toBe(0);
        window.close();
    });

    it('requests another invitation when the link is missing or already used', async () => {
        const missing = open('');
        expect(missing.button.hidden).toBe(true);
        expect(missing.status.textContent).toContain('fresh pairing link');
        missing.window.close();

        const { window, button, fetch, status } = open(invite);
        fetch.mockResolvedValue({ ok: false, status: 404 });
        button.click();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/device-pairing/claim',
            expect.objectContaining({
                method: 'POST',
                redirect: 'error',
                body: JSON.stringify({ inviteId: invite, name: 'Web browser' }),
            })
        );
        expect(status.textContent).toContain('fresh pairing link');
        expect(window.localStorage.length).toBe(0);
        window.close();
    });

    it('explains when browser storage cannot save the approved credential', async () => {
        const { window, button, fetch, status } = open(invite);
        const claim = {
            claimId: 'B'.repeat(43),
            claimSecret: 'C'.repeat(43),
            confirmationCode: '012345',
        };
        const approved = {
            status: 'approved',
            token: 'D'.repeat(43),
            instanceId: 'test-instance',
        };
        const reply = (value: object) => ({
            ok: true,
            json: async () => value,
        });
        fetch
            .mockResolvedValueOnce(reply(claim))
            .mockResolvedValueOnce(reply(approved));
        const setTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback) => setTimeout(callback, 0);
        await new Promise<void>((resolve) => {
            jest.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
                resolve();
                throw new Error('Storage refused');
            });
            button.click();
        });
        expect(fetch).toHaveBeenLastCalledWith(
            '/api/v1/device-pairing/complete',
            expect.objectContaining({
                body: JSON.stringify({
                    claimId: claim.claimId,
                    claimSecret: claim.claimSecret,
                }),
            })
        );
        expect(status.textContent).toContain(
            'Allow this site to save browser data'
        );
        expect(window.location.pathname).toBe('/pair-device');
        window.close();
    });
});
