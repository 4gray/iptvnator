import './theme.css';
/** Phone-only setup UI; the capability stays in this page’s memory. */
export function phoneClient() {
    window.addEventListener('hashchange', () => {
        if (location.hash) location.reload();
    });
    const fragment = location.hash.slice(1).split('.');
    const [id, token] = fragment;
    // Keep the capability in this tab's memory, out of the address bar and referrers.
    history.replaceState(null, '', location.pathname);
    const form = document.querySelector<HTMLFormElement>('form')!;
    const status = document.querySelector<HTMLElement>('[role=status]')!;
    const submit = form.querySelector<HTMLButtonElement>(
        'button[type=submit]'
    )!;
    const provider = form.elements.namedItem('provider') as HTMLSelectElement;
    let finished = false;
    let sent = false;
    const endpoint = `./pairing/${encodeURIComponent(id ?? '')}/phone`;
    async function request(method = 'GET', body?: unknown) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 8000);
        try {
            const response = await fetch(endpoint, {
                method,
                signal: abort.signal,
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    'X-TV-Pairing': token ?? '',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const data = await response.json();
            if (!response.ok) {
                if ([403, 410].includes(response.status)) finished = true;
                throw new Error(
                    data.message || 'Could not reach the TV. Try again.'
                );
            }
            return data as { status: string };
        } finally {
            clearTimeout(timer);
        }
    }
    function fields() {
        const type = provider.value;
        document
            .querySelectorAll<HTMLElement>('[data-providers]')
            .forEach((group) => {
                const visible = group.dataset
                    .providers!.split(' ')
                    .includes(type);
                group.hidden = !visible;
                group
                    .querySelectorAll<HTMLInputElement>('input')
                    .forEach((input) => {
                        input.disabled = !visible;
                        input.required =
                            visible &&
                            (input.name === 'macAddress' ||
                                (type === 'xtream' &&
                                    ['username', 'password'].includes(
                                        input.name
                                    )));
                    });
            });
        document.querySelector('#url-label')!.textContent =
            type === 'm3u' ? 'Playlist URL' : 'Provider URL';
    }
    provider.onchange = fields;
    fields();
    function render(state: string) {
        if (state === 'waiting' && !sent) {
            form.hidden = false;
            submit.disabled = false;
            status.textContent =
                'Enter your source details. Confirm on the TV to finish.';
            return;
        }
        form.hidden = true;
        status.textContent =
            state === 'saved'
                ? 'Added to your TV. You can close this page.'
                : state === 'rejected'
                  ? 'The source was declined on the TV. Open a new QR code to try again.'
                  : state === 'cancelled'
                    ? 'Setup was cancelled on the TV. Open a new QR code to try again.'
                    : 'Sent. Confirm “Add source” on your TV.';
        finished = ['saved', 'rejected', 'cancelled'].includes(state);
    }
    async function poll() {
        if (finished) return;
        try {
            render((await request()).status);
        } catch (error) {
            status.textContent =
                error instanceof Error
                    ? error.message
                    : 'Connection interrupted.';
            if (finished) form.hidden = true;
        }
        if (!finished) setTimeout(poll, 1500);
    }
    form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        const values = new FormData(form);
        const data: Record<string, string> = {};
        values.forEach((value, key) => {
            data[key] = String(value);
        });
        sent = true;
        try {
            render((await request('POST', data)).status);
            form.reset();
        } catch (error) {
            // A lost response may still mean delivery; polling retrieves its receipt.
            sent = false;
            status.textContent =
                error instanceof Error
                    ? error.message
                    : 'Could not send. Retry.';
            submit.disabled = finished;
        }
    };
    if (!id || !token) {
        finished = true;
        form.hidden = true;
        status.textContent =
            'Open a new QR code on the TV. This page needs a one-time setup link.';
    } else void poll();
}

phoneClient();
