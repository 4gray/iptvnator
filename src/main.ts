import { enableProdMode } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';
import { AppConfig } from './environments/environment';

if (AppConfig.production) {
    enableProdMode();
}

// Detect if running in Tauri
const isTauri = window && (window as any).__TAURI__;

platformBrowserDynamic()
    .bootstrapModule(AppModule, {
        preserveWhitespaces: false,
    })
    .then(() => {
        // Only register service worker for web builds
        if (!isTauri && 'serviceWorker' in navigator) {
            navigator.serviceWorker.register('/ngsw-worker.js');
        }
    })
    .catch((err) => console.error(err));
