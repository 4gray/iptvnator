import type { Express } from 'express';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approve TV in IPTVnator</title>
<style>
:root { color-scheme: light dark; font: 1rem/1.5 system-ui, sans-serif; }
body { margin: 0; padding: 2rem 1rem; }
main { max-width: 28rem; margin: auto; }
h1 { font-size: 1.65rem; line-height: 1.25; }
label { display: block; }
input, button { font: inherit; min-height: 2.75rem; box-sizing: border-box; }
input { display: block; width: 100%; margin: .35rem 0 .85rem; padding: .5rem; }
button { padding: .45rem 1rem; }
code { font-size: 1.65rem; letter-spacing: .15em; }
</style>
<script src="/approve-device.js" defer></script>
</head>
<body><main>
<h1>Approve TV in IPTVnator</h1>
<p id="status" role="status">Checking pairing request…</p>
<form id="sign-in" hidden>
    <label for="owner-password">Phone approval password</label>
    <input id="owner-password" name="password" type="password" required maxlength="128" autocomplete="current-password">
    <button type="submit">Sign in</button>
</form>
<section id="request" hidden aria-label="Pairing request">
    <p id="device-name"></p>
    <p>Check that this code matches the one on your TV.</p>
    <p><code id="confirmation-code"></code></p>
    <button id="approve" type="button">Codes match, approve TV</button>
</section>
<noscript>Turn on JavaScript and scan the QR code again.</noscript>
</main></body>
</html>`;

const script = `
const claimId = /^[/]approve-device[/]([A-Za-z0-9_-]{43})$/.exec(location.pathname)?.[1];
history.replaceState(null, '', '/approve-device');
const status = document.getElementById('status');
const signIn = document.getElementById('sign-in');
const password = document.getElementById('owner-password');
const request = document.getElementById('request');
const approve = document.getElementById('approve');
const signInButton = signIn.querySelector('button');
const expired = 'This request has expired or was already approved. Check your TV or start pairing again.';
const unavailable = 'Could not reach IPTVnator. Check the server and try again.';

const post = (action, data) => fetch('/api/v1/device-pairing/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
});

function requireSignIn() {
    request.hidden = true;
    signIn.hidden = false;
    status.textContent = 'Sign in with the password you set in Server settings on your computer.';
    password.focus();
}

async function readRequest() {
    const response = await post('browser-request', { claimId });
    if (response.status === 401) {
        requireSignIn();
        return;
    }
    if (response.status === 404) {
        status.textContent = expired;
        return;
    }
    if (!response.ok) throw new Error('Pairing request unavailable');
    const details = await response.json();
    if (typeof details.name !== 'string' ||
        typeof details.confirmationCode !== 'string' ||
        !/^[0-9]{6}$/.test(details.confirmationCode)) {
        throw new Error('Invalid pairing request');
    }
    document.getElementById('device-name').textContent = details.name;
    document.getElementById('confirmation-code').textContent = details.confirmationCode;
    signIn.hidden = true;
    status.textContent = '';
    request.hidden = false;
    approve.focus();
}

signIn.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signInButton.disabled) return;
    signInButton.disabled = true;
    const attempt = password.value;
    password.value = '';
    try {
        const response = await post('browser-session', { password: attempt });
        if (response.status === 401) {
            status.textContent = 'Check the phone approval password on your computer and try again.';
            password.focus();
        } else if (response.status === 429) {
            status.textContent = 'Too many attempts. Wait a minute and try again.';
        } else if (response.ok) {
            signIn.hidden = true;
            await readRequest();
        } else {
            throw new Error('Sign-in unavailable');
        }
    } catch {
        status.textContent = unavailable;
    } finally {
        signInButton.disabled = false;
    }
});

approve.addEventListener('click', async () => {
    if (approve.disabled) return;
    approve.disabled = true;
    try {
        const response = await post('browser-approve', { claimId });
        if (response.status === 401) {
            requireSignIn();
        } else if (response.status === 404) {
            request.hidden = true;
            status.textContent = expired;
        } else if (response.ok) {
            request.hidden = true;
            status.textContent = 'TV approved. Your library will open on the TV.';
        } else {
            throw new Error('Approval unavailable');
        }
    } catch {
        status.textContent = unavailable;
    } finally {
        approve.disabled = false;
    }
});

if (location.protocol !== 'https:') {
    status.textContent = 'Phone approval requires HTTPS. Scan the QR code shown on your TV.';
} else if (!claimId) {
    status.textContent = 'Scan the QR code shown on your TV to open its pairing request.';
} else {
    readRequest().catch(() => { status.textContent = unavailable; });
}
`;

export function mountHostedTvApprovalPage(app: Express): void {
    app.get(['/approve-device', '/approve-device/:claimId'], (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        })
            .type('html')
            .send(page);
    });
    app.get('/approve-device.js', (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        })
            .type('js')
            .send(script);
    });
}
