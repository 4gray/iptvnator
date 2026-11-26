import type { Express } from 'express';
import {
    HOSTED_BROWSER_TOKEN_PREFIX,
    SOURCE_SERVER_CONNECTION_KEY,
    SOURCE_SERVER_DISABLED_KEY,
} from '@iptvnator/shared/interfaces';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair IPTVnator</title>
<style>
:root { color-scheme: light dark; font: 1rem/1.5 system-ui, sans-serif; }
body { margin: 0; padding: 2rem 1rem; }
main { max-width: 28rem; margin: auto; }
a { color: LinkText; }
.action { padding: .65rem 1rem; border: 1px solid currentColor; border-radius: .5rem; font: inherit; }
</style>
<script src="/pair-device.js" defer></script>
</head>
<body><main>
<h1>Pair this device</h1>
<p id="pairing-help" role="status">Open a fresh pairing link from IPTVnator on the host computer.</p>
<p><strong id="confirmation-code"></strong></p>
<button type="button" class="action" id="pair-browser" hidden>Pair this browser</button>
<a class="action" id="open-iptvnator" hidden>Open IPTVnator</a>
<noscript>Enable JavaScript to pair this browser.</noscript>
</main></body></html>`;

const script = `
const invite = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const status = document.getElementById('pairing-help');
const code = document.getElementById('confirmation-code');
const button = document.getElementById('pair-browser');
const freshLink = 'Open a fresh pairing link from IPTVnator on the host computer.';

async function post(action, data) {
    const response = await fetch('/api/v1/device-pairing/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Pairing request failed');
    return response.json();
}

if (validSecret(invite)) {
    const open = document.getElementById('open-iptvnator');
    const link = new URL('iptvnator://pair');
    link.searchParams.set('server', location.origin);
    link.searchParams.set('invite', invite);
    open.href = link.href;
    open.hidden = false;
    button.hidden = false;
    status.textContent = 'Pair this browser to open the web player, or open IPTVnator on Android.';
    button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        open.hidden = true;
        open.removeAttribute('href');
        status.textContent = 'Requesting pairing…';
        try {
            const { claimId, claimSecret, confirmationCode } = await post('claim', {
                inviteId: invite, name: 'Web browser',
            });
            if (!validSecret(claimId) || !validSecret(claimSecret) || !/^[0-9]{6}$/.test(confirmationCode))
                throw new Error('Invalid claim');
            code.textContent = confirmationCode;
            status.textContent = 'Compare this code with the one on the host computer and approve the browser there.';
            let result;
            do {
                await new Promise(resolve => setTimeout(resolve, 2000));
                result = await post('complete', { claimId, claimSecret });
            } while (result.status === 'pending');
            if (result.status !== 'approved' || !validSecret(result.token) ||
                typeof result.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.instanceId))
                throw new Error('Invalid device credential');
            code.textContent = '';
            const connection = { apiUrl: location.origin + '/api', instanceId: result.instanceId };
            try {
                localStorage.setItem('${HOSTED_BROWSER_TOKEN_PREFIX}' + connection.instanceId, result.token);
                localStorage.setItem('${SOURCE_SERVER_CONNECTION_KEY}', JSON.stringify(connection));
                localStorage.removeItem('${SOURCE_SERVER_DISABLED_KEY}');
            } catch {
                status.textContent = 'Allow this site to save browser data, then open a fresh pairing link.';
                return;
            }
            location.replace('/');
        } catch {
            code.textContent = '';
            status.textContent = 'Could not finish pairing. ' + freshLink;
        }
    };
}
`;

export function mountHostedDevicePage(app: Express): void {
    app.get('/pair-device', (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        })
            .type('html')
            .send(page);
    });
    app.get('/pair-device.js', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('js').send(script);
    });
}
