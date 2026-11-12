import type { Express } from 'express';

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
.action { display: inline-block; padding: .65rem 1rem; border: 1px solid currentColor; border-radius: .5rem; }
</style>
<script src="/pair-device.js" defer></script>
</head>
<body><main>
<h1>Pair this device</h1>
<p id="pairing-help">Open the IPTVnator Android app, then compare the code with the one shown on your computer.</p>
<a class="action" id="open-iptvnator" hidden>Open IPTVnator</a>
<p><a href="/">Open the web player</a></p>
</main></body></html>`;

const script = `
const invite = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
if (/^[A-Za-z0-9_-]{43}$/.test(invite)) {
    const open = document.getElementById('open-iptvnator');
    const link = new URL('iptvnator://pair');
    link.searchParams.set('server', location.origin);
    link.searchParams.set('invite', invite);
    open.href = link.href;
    open.hidden = false;
} else {
    document.getElementById('pairing-help').textContent =
        'Show a new pairing QR code in IPTVnator on your computer and scan it again.';
}
`;

export function mountHostedDevicePage(app: Express): void {
    app.get('/pair-device', (_req, res) => {
        res.set({
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        })
            .type('html')
            .send(page);
    });
    app.get('/pair-device.js', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('js').send(script);
    });
}
