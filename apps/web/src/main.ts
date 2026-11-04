import { bootstrapApplication } from '@angular/platform-browser';
import { prepareRendererReload } from './renderer-reload';
import { registerAppDateLocale } from './app/app-date-locales';
import { AppComponent } from './app/app.component';
import { appConfig, getInitialLanguage } from './app/app.config';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';

prepareRendererReload(window, document.baseURI);

// Angular ships only English locale data; the preferred language's data is a
// lazy chunk. It is awaited before bootstrapping because the first route
// renders dates with that locale, and a locale without data throws. English
// (the default) resolves immediately.
Promise.all([
    registerAppDateLocale(getInitialLanguage()),
    prepareSourceConnection(window.__IPTVNATOR_CONFIG__?.BACKEND_URL),
])
    .then(() => bootstrapApplication(AppComponent, appConfig))
    .then(() => {
        // Splash is rendered eagerly by index.html so the user sees something
        // immediately instead of a blank Material-grey background. Once Angular
        // is bootstrapped, AppComponent has rendered and we can drop the
        // splash. requestAnimationFrame ensures the swap happens after the
        // first AppComponent paint, avoiding a flash of empty background
        // between splash removal and Angular's first frame.
        requestAnimationFrame(() => {
            document.getElementById('initial-splash')?.remove();
        });
    })
    .catch((err) => console.error(err));
