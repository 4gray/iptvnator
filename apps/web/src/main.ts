import { bootstrapApplication } from '@angular/platform-browser';
import { registerAppDateLocales } from './app/app-date-locales';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

registerAppDateLocales();

bootstrapApplication(AppComponent, appConfig).catch((err) =>
    console.error(err)
);
