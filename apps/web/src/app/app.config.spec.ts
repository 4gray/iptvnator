import { ANIMATION_MODULE_TYPE, RendererFactory2 } from '@angular/core';

type ProviderEntry = { provide?: unknown };

function flattenProviders(providers: readonly unknown[]): ProviderEntry[] {
    return providers.flatMap((provider) => {
        if (Array.isArray(provider)) {
            return flattenProviders(provider);
        }
        // makeEnvironmentProviders() wraps its list in ɵproviders.
        const wrapped = (provider as { ɵproviders?: unknown[] } | null)
            ?.ɵproviders;
        return wrapped
            ? flattenProviders(wrapped)
            : [provider as ProviderEntry];
    });
}

describe('appConfig', () => {
    // The @angular/animations renderer queues every DOM removal until the
    // end of the next change detection, while the router inserts a routed
    // page at once: leaving a portal for the dashboard laid out both pages
    // until the coalesced tick and scored the swap as a layout shift.
    it('keeps the default DOM renderer, so routed pages swap in one task', async () => {
        const { appConfig } = await import('./app.config');
        const tokens = flattenProviders(appConfig.providers).map(
            (provider) => provider?.provide
        );

        expect(tokens).not.toContain(RendererFactory2);
        expect(tokens).not.toContain(ANIMATION_MODULE_TYPE);
    });
});
