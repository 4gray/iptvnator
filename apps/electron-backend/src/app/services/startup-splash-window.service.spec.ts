import {
    createStartupSplashHtml,
    createStartupSplashUpdate,
    normalizeStartupSplashLanguage,
} from './startup-splash-window.service';

describe('startup splash window copy', () => {
    it('uses Italian copy when the app language is Italian', () => {
        const update = createStartupSplashUpdate('it', 'vpn', 28);
        const html = createStartupSplashHtml('it', update);

        expect(update).toEqual(
            expect.objectContaining({
                detail: expect.stringContaining("Verifico l'integrazione VPN"),
                status: 'Controllo VPN',
            })
        );
        expect(html).toContain('<html lang="it">');
        expect(html).toContain('Avvio dell&#39;applicazione');
        expect(html).toContain('Controllo VPN e rete configurata');
    });

    it('falls back to English copy for unsupported startup languages', () => {
        expect(normalizeStartupSplashLanguage('de')).toBe('en');

        const update = createStartupSplashUpdate('de', 'settings', 8);
        const html = createStartupSplashHtml('en', update);

        expect(update).toEqual(
            expect.objectContaining({
                detail: 'Reading local settings and preparing the session.',
                status: 'Preparing startup',
            })
        );
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('Application startup');
        expect(html).toContain('Reading local settings and database');
    });
});
