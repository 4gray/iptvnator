import 'reflect-metadata';
import '../polyfills';

import { AppRoutingModule } from './app-routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { NgxWhatsNewModule } from 'ngx-whats-new';
import { SharedModule } from './shared/shared.module';

// NG Translate
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

import { AppComponent } from './app.component';
import { ElectronService } from './services/electron.service';
import { PwaService } from './services/pwa.service';
import { DataService } from './services/data.service';
// AoT requires an exported function for factories
export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
    return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

function isElectron(): boolean {
    return !!(window && window.process && window.process.type);
}

export function AuthenticationFactory() {
    if (isElectron()) {
        return new ElectronService();
    }
    return new PwaService();
}

@NgModule({
    declarations: [AppComponent],
    imports: [
        AppRoutingModule,
        BrowserAnimationsModule,
        BrowserModule,
        HttpClientModule,
        NgxWhatsNewModule,
        SharedModule,
        TranslateModule.forRoot({
            loader: {
                provide: TranslateLoader,
                useFactory: HttpLoaderFactory,
                deps: [HttpClient],
            },
        }),
    ],
    providers: [
        {
            provide: DataService,
            useFactory: AuthenticationFactory,
        },
    ],
    bootstrap: [AppComponent],
})
export class AppModule {}
