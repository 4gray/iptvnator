import {
    SOURCE_SERVER_CONNECTION_KEY,
    SOURCE_SERVER_DISABLED_KEY,
} from '@iptvnator/shared/interfaces';
import type { Express } from 'express';
import { prepareCloudflareBrowserDevice } from './storage/cloudflare-device-access';

const path = '/connect-device.html';
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to IPTVnator</title><script src="/connect-device.js" defer></script>
</head><body><main><h1>Connect this browser</h1>
<p id="status" role="status">Open a fresh pairing link from IPTVnator on the host computer.</p>
<button id="connect" type="button" hidden>Connect this browser</button>
</main></body></html>`;

const script = `
const fields = new URLSearchParams(location.hash.slice(1));
const instance = fields.get('iptvnator-access') || '';
const inviteId = fields.get('invite') || '';
const button = document.getElementById('connect');
const status = document.getElementById('status');
history.replaceState(null, '', location.pathname);
if (/^[A-Za-z0-9_-]{1,200}$/.test(instance) && /^[A-Za-z0-9_-]{43}$/.test(inviteId)) {
    button.hidden = false;
    status.textContent = 'Register this browser with the host computer to open the shared library.';
    button.onclick = async () => {
        button.disabled = true;
        try {
            const response = await fetch('/api/v1/device-pairing/cloudflare', {
                method: 'POST',
                redirect: 'error',
                headers: { 'Content-Type': 'application/json', 'X-IPTVnator-Instance-Id': instance },
                body: JSON.stringify({ inviteId, name: 'Web browser' }),
            });
            if (response.status === 204) {
                try {
                    const connection = { apiUrl: location.origin + '/api', instanceId: instance };
                    localStorage.setItem('${SOURCE_SERVER_CONNECTION_KEY}', JSON.stringify(connection));
                    localStorage.removeItem('${SOURCE_SERVER_DISABLED_KEY}');
                } catch {
                    status.textContent = 'Allow this site to save browser data, then try connecting again.';
                    button.disabled = false;
                    return;
                }
                location.replace('/');
            } else if (response.headers.get('X-IPTVnator-Device-Status') === 'revoked') {
                status.textContent = 'This browser was revoked on the host computer.';
            } else {
                status.textContent = 'Open a fresh pairing link from IPTVnator on the host computer.';
            }
        } catch {
            status.textContent = 'Could not contact the host computer. Try again.';
            button.disabled = false;
        }
    };
}
`;

export function mountHostedCloudflareDevicePage(app: Express): void {
    app.get(path, (req, res) => {
        prepareCloudflareBrowserDevice(req, res);
        res.set({
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        }).type('html').send(page);
    });
    app.get('/connect-device.js', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('js').send(script);
    });
}
