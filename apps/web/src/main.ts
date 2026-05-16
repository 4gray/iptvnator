import { bootstrapApplication } from '@angular/platform-browser';
import { registerAppDateLocales } from './app/app-date-locales';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { markAppRenderedWhenReady } from './app/startup-render-ready';

registerAppDateLocales();

bootstrapApplication(AppComponent, appConfig)
    .then((appRef) => {
        // Splash is rendered eagerly by index.html so the user sees something
        // immediately instead of a blank Material-grey background. Once Angular
        // and the first router navigation have settled, drop the splash and
        // notify Electron that the window can be shown without a white frame.
        void markAppRenderedWhenReady(appRef);
    })
    .catch((err) => console.error(err));
