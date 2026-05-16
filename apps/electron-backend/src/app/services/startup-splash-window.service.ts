import { BrowserWindow, screen } from 'electron';

export type StartupSplashPhase =
    | 'settings'
    | 'vpn'
    | 'window'
    | 'metadata'
    | 'ready'
    | 'error';

export interface StartupSplashUpdate {
    phase: StartupSplashPhase;
    status: string;
    detail: string;
    progress?: number;
}

export type StartupSplashLanguage = 'en' | 'it';

interface StartupSplashStaticCopy {
    appStart: string;
    ariaLabel: string;
    fallbackStatus: string;
    foot: string;
    htmlLang: string;
    title: string;
    steps: Record<Exclude<StartupSplashPhase, 'ready' | 'error'>, string>;
}

const STARTUP_SPLASH_STATIC_COPY: Record<
    StartupSplashLanguage,
    StartupSplashStaticCopy
> = {
    en: {
        appStart: 'Application startup',
        ariaLabel: 'Startup status',
        fallbackStatus: 'Starting IPTVnator',
        foot: 'The main window will open as soon as the interface is ready. Metadata will continue loading in the background without blocking the app.',
        htmlLang: 'en',
        title: 'IPTVnator - startup',
        steps: {
            settings: 'Reading local settings and database',
            vpn: 'Checking VPN and configured network',
            window: 'Creating the main window',
            metadata: 'Starting metadata and filters in the background',
        },
    },
    it: {
        appStart: "Avvio dell'applicazione",
        ariaLabel: 'Stato avvio',
        fallbackStatus: 'Avvio IPTVnator',
        foot: "La finestra principale si aprirà appena l'interfaccia sarà pronta. I metadati continueranno a caricarsi in background senza bloccare l'app.",
        htmlLang: 'it',
        title: 'IPTVnator - avvio',
        steps: {
            settings: 'Leggo impostazioni locali e database',
            vpn: 'Controllo VPN e rete configurata',
            window: 'Creo la finestra principale',
            metadata: 'Avvio metadati e filtri in background',
        },
    },
};

const STARTUP_SPLASH_PHASE_COPY: Record<
    StartupSplashLanguage,
    Record<StartupSplashPhase, Pick<StartupSplashUpdate, 'status' | 'detail'>>
> = {
    en: {
        settings: {
            status: 'Preparing startup',
            detail: 'Reading local settings and preparing the session.',
        },
        vpn: {
            status: 'Checking VPN',
            detail: 'Checking the configured VPN integration and preparing the network without opening unnecessary windows.',
        },
        window: {
            status: 'Opening the main window',
            detail: 'Creating the interface and connecting local app services.',
        },
        metadata: {
            status: 'Loading interface and filters',
            detail: 'Starting metadata, language/quality filters, and catalog work in the background while the UI is prepared.',
        },
        ready: {
            status: 'Ready',
            detail: 'IPTVnator is ready. Opening the main window.',
        },
        error: {
            status: 'Startup needs attention',
            detail: 'The app is keeping this screen visible instead of showing a blank window.',
        },
    },
    it: {
        settings: {
            status: 'Preparazione avvio',
            detail: 'Sto leggendo le impostazioni locali e preparando la sessione.',
        },
        vpn: {
            status: 'Controllo VPN',
            detail: "Verifico l'integrazione VPN configurata e preparo la rete senza aprire finestre inutili.",
        },
        window: {
            status: 'Apro la finestra principale',
            detail: "Creo l'interfaccia e collego i servizi locali dell'app.",
        },
        metadata: {
            status: 'Carico interfaccia e filtri',
            detail: 'Avvio metadati, filtri lingua/qualità e catalogo in background mentre preparo la UI.',
        },
        ready: {
            status: 'Pronto',
            detail: 'IPTVnator è pronto. Apro la finestra principale.',
        },
        error: {
            status: 'Avvio da controllare',
            detail: 'Tengo visibile questa schermata invece di mostrare una finestra bianca.',
        },
    },
};

export function normalizeStartupSplashLanguage(
    value: unknown
): StartupSplashLanguage {
    return value === 'it' ? 'it' : 'en';
}

export function createStartupSplashUpdate(
    language: unknown,
    phase: StartupSplashPhase,
    progress?: number,
    override: Partial<Pick<StartupSplashUpdate, 'status' | 'detail'>> = {}
): StartupSplashUpdate {
    const normalizedLanguage = normalizeStartupSplashLanguage(language);
    const copy = STARTUP_SPLASH_PHASE_COPY[normalizedLanguage][phase];

    return {
        phase,
        status: override.status ?? copy.status,
        detail: override.detail ?? copy.detail,
        progress,
    };
}

const DEFAULT_SPLASH_UPDATE = createStartupSplashUpdate('en', 'settings', 8);

export class StartupSplashWindow {
    private window: BrowserWindow | null = null;
    private isLoaded = false;
    private pendingUpdate: StartupSplashUpdate = DEFAULT_SPLASH_UPDATE;

    constructor(
        private readonly BrowserWindowCtor: typeof BrowserWindow,
        private readonly language: StartupSplashLanguage = 'en'
    ) {}

    show(update: StartupSplashUpdate = DEFAULT_SPLASH_UPDATE): Promise<void> {
        this.pendingUpdate = update;

        if (this.window && !this.window.isDestroyed()) {
            this.update(update);
            return this.isLoaded ? Promise.resolve() : this.waitUntilLoaded();
        }

        const workArea = screen.getPrimaryDisplay().workArea;
        const width = 480;
        const height = 340;

        this.window = new this.BrowserWindowCtor({
            width,
            height,
            x: Math.round(workArea.x + (workArea.width - width) / 2),
            y: Math.round(workArea.y + (workArea.height - height) / 2),
            alwaysOnTop: true,
            backgroundColor: '#111318',
            frame: false,
            fullscreenable: false,
            maximizable: false,
            minimizable: false,
            movable: true,
            resizable: false,
            show: false,
            skipTaskbar: false,
            title: STARTUP_SPLASH_STATIC_COPY[this.language].title,
            webPreferences: {
                backgroundThrottling: false,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });

        this.window.setMenu(null);
        this.window.on('closed', () => {
            this.window = null;
            this.isLoaded = false;
        });

        const loadPromise = this.waitUntilLoaded();

        void this.window
            .loadURL(
                `data:text/html;charset=utf-8,${encodeURIComponent(
                    createStartupSplashHtml(this.language, this.pendingUpdate)
                )}`
            )
            .catch((error) => {
                console.warn('Failed to load startup splash window:', error);
            });

        return loadPromise;
    }

    update(update: StartupSplashUpdate): void {
        this.pendingUpdate = update;

        if (!this.window || this.window.isDestroyed() || !this.isLoaded) {
            return;
        }

        const serializedUpdate = JSON.stringify(update).replace(
            /</g,
            '\\u003c'
        );
        void this.window.webContents
            .executeJavaScript(
                `window.iptvnatorSplashUpdate(${serializedUpdate});`,
                true
            )
            .catch((error) => {
                console.warn('Failed to update startup splash window:', error);
            });
    }

    close(): void {
        if (!this.window || this.window.isDestroyed()) {
            return;
        }

        this.window.close();
        this.window = null;
        this.isLoaded = false;
    }

    private waitUntilLoaded(): Promise<void> {
        if (!this.window || this.window.isDestroyed() || this.isLoaded) {
            return Promise.resolve();
        }

        const splashWindow = this.window;

        return new Promise((resolve) => {
            const resolveLoaded = () => {
                if (!this.window || this.window.isDestroyed()) {
                    resolve();
                    return;
                }

                this.isLoaded = true;
                this.update(this.pendingUpdate);
                if (!splashWindow.isVisible()) {
                    splashWindow.show();
                }
                setImmediate(resolve);
            };

            splashWindow.webContents.once('did-finish-load', resolveLoaded);
        });
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function createStartupSplashHtml(
    language: StartupSplashLanguage,
    initialUpdate: StartupSplashUpdate
): string {
    const copy = STARTUP_SPLASH_STATIC_COPY[language];
    const initialProgress = Math.max(
        6,
        Math.min(100, Number(initialUpdate.progress || 0))
    );

    return `<!doctype html>
<html lang="${escapeHtml(copy.htmlLang)}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.title)}</title>
<style>
:root {
    color-scheme: dark;
    --bg: #111318;
    --surface: #191d24;
    --surface-soft: #202734;
    --text: #f3f5f8;
    --muted: #aab2bf;
    --line: rgba(255,255,255,0.1);
    --accent: #38bdf8;
    --ok: #7dd3a8;
    --warn: #f4c56b;
    --error: #fb7185;
}
* { box-sizing: border-box; }
body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background:
        linear-gradient(135deg, rgba(56,189,248,0.14), transparent 32%),
        linear-gradient(315deg, rgba(125,211,168,0.13), transparent 34%),
        var(--bg);
    color: var(--text);
    font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    user-select: none;
}
.shell {
    width: 100%;
    height: 100vh;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    border: 1px solid var(--line);
}
.brand {
    display: flex;
    align-items: center;
    gap: 12px;
}
.mark {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--surface-soft);
    color: var(--accent);
    font-weight: 800;
    letter-spacing: 0;
}
h1, h2, p { margin: 0; }
h1 {
    font-size: 1rem;
    font-weight: 750;
    letter-spacing: 0;
}
.brand p {
    margin-top: 2px;
    color: var(--muted);
    font-size: 0.78rem;
}
.activity {
    display: grid;
    grid-template-columns: 58px 1fr;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(25,29,36,0.74);
}
.spinner {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    border: 4px solid rgba(255,255,255,0.1);
    border-top-color: var(--accent);
    border-right-color: var(--ok);
    animation: spin 0.95s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
h2 {
    font-size: 1.02rem;
    font-weight: 720;
    letter-spacing: 0;
}
#detail {
    margin-top: 6px;
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.38;
}
.steps {
    display: grid;
    gap: 8px;
}
.step {
    display: grid;
    grid-template-columns: 18px 1fr;
    align-items: center;
    gap: 9px;
    color: var(--muted);
    font-size: 0.78rem;
}
.dot {
    width: 9px;
    height: 9px;
    justify-self: center;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.08);
}
.step.is-current { color: var(--text); }
.step.is-current .dot {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgba(56,189,248,0.14);
}
.step.is-done .dot {
    background: var(--ok);
    border-color: var(--ok);
}
.step.is-error .dot {
    background: var(--error);
    border-color: var(--error);
}
.progress {
    overflow: hidden;
    height: 7px;
    border-radius: 999px;
    background: rgba(255,255,255,0.09);
}
#progressBar {
    display: block;
    height: 100%;
    width: 8%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent), var(--ok));
    transition: width 0.22s ease;
}
.foot {
    margin-top: auto;
    color: var(--muted);
    font-size: 0.74rem;
    line-height: 1.35;
}
</style>
</head>
<body>
<main class="shell" aria-live="polite">
    <section class="brand">
        <div class="mark">IP</div>
        <div>
            <h1>IPTVnator</h1>
            <p>${escapeHtml(copy.appStart)}</p>
        </div>
    </section>
    <section class="activity">
        <div class="spinner" aria-hidden="true"></div>
        <div>
            <h2 id="status">${escapeHtml(initialUpdate.status)}</h2>
            <p id="detail">${escapeHtml(initialUpdate.detail)}</p>
        </div>
    </section>
    <section class="steps" aria-label="${escapeHtml(copy.ariaLabel)}">
        <div class="step" data-step="settings"><span class="dot"></span><span>${escapeHtml(copy.steps.settings)}</span></div>
        <div class="step" data-step="vpn"><span class="dot"></span><span>${escapeHtml(copy.steps.vpn)}</span></div>
        <div class="step" data-step="window"><span class="dot"></span><span>${escapeHtml(copy.steps.window)}</span></div>
        <div class="step" data-step="metadata"><span class="dot"></span><span>${escapeHtml(copy.steps.metadata)}</span></div>
    </section>
    <div class="progress" aria-hidden="true"><span id="progressBar" style="width: ${initialProgress}%"></span></div>
    <p class="foot">${escapeHtml(copy.foot)}</p>
</main>
<script>
const order = ["settings", "vpn", "window", "metadata", "ready"];
const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");
const progressEl = document.getElementById("progressBar");
window.iptvnatorSplashUpdate = function(update) {
    statusEl.textContent = update.status || ${JSON.stringify(copy.fallbackStatus)};
    detailEl.textContent = update.detail || "";
    progressEl.style.width = Math.max(6, Math.min(100, Number(update.progress || 0))) + "%";
    const phaseIndex = order.indexOf(update.phase);
    document.querySelectorAll(".step").forEach((step) => {
        const stepIndex = order.indexOf(step.dataset.step);
        step.classList.remove("is-current", "is-done", "is-error");
        if (update.phase === "error") {
            step.classList.add("is-error");
        } else if (stepIndex >= 0 && phaseIndex >= 0 && stepIndex < phaseIndex) {
            step.classList.add("is-done");
        } else if (stepIndex === phaseIndex) {
            step.classList.add("is-current");
        }
    });
};
window.iptvnatorSplashUpdate(${JSON.stringify(initialUpdate).replace(/</g, '\\u003c')});
</script>
</body>
</html>`;
}
