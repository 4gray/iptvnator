import { bootstrapApplication } from '@angular/platform-browser';
import { resolveRestoredRendererRoute } from '@iptvnator/shared/interfaces';
import { registerAppDateLocale } from './app/app-date-locales';
import { AppComponent } from './app/app.component';
import { appConfig, getInitialLanguage } from './app/app.config';

// A reloaded packaged renderer arrives on index.html with the route it was
// on carried in the query string (the Electron main process recovers the
// file:// reload that way). Put that route back before the router reads the
// URL for its initial navigation.
const restoredHref = resolveRestoredRendererRoute(
    window.location.href,
    document.baseURI
);
if (restoredHref !== null) {
    window.history.replaceState(window.history.state, '', restoredHref);
}

// Angular ships only English locale data; the preferred language's data is a
// lazy chunk. It is awaited before bootstrapping because the first route
// renders dates with that locale, and a locale without data throws. English
// (the default) resolves immediately.
registerAppDateLocale(getInitialLanguage())
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
