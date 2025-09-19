import { enableProdMode } from '@angular/core';
import { platformBrowser } from '@angular/platform-browser';
import { AppModule } from './app/app.module';
import { AppConfig } from './environments/environment';

if (AppConfig.production) {
    enableProdMode();
}

platformBrowser()
    .bootstrapModule(AppModule, {
        preserveWhitespaces: false,
    })
    .catch((err) => console.error(err));
