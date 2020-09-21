import 'reflect-metadata';
import '../polyfills';

import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { SharedModule } from './shared/shared.module';

import { AppRoutingModule } from './app-routing.module';

// NG Translate
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

import { AppComponent } from './app.component';
import { CommonModule } from '@angular/common';
import { PlaylistUploaderComponent } from './playlist-uploader/playlist-uploader.component';
import { NgxUploaderModule } from 'ngx-uploader';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RecentPlaylistsComponent } from './recent-playlists/recent-playlists.component';
import { ChannelListContainerComponent } from './channel-list-container/channel-list-container.component';
import { FilterPipeModule } from 'ngx-filter-pipe';

// AoT requires an exported function for factories
export function HttpLoaderFactory(http: HttpClient): TranslateHttpLoader {
    return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

@NgModule({
    declarations: [
        AppComponent,
        ChannelListContainerComponent,
        PlaylistUploaderComponent,
        VideoPlayerComponent,
        RecentPlaylistsComponent,
    ],
    imports: [
        CommonModule,
        BrowserAnimationsModule,
        BrowserModule,
        HttpClientModule,
        SharedModule,
        AppRoutingModule,
        FilterPipeModule,
        TranslateModule.forRoot({
            loader: {
                provide: TranslateLoader,
                useFactory: HttpLoaderFactory,
                deps: [HttpClient],
            },
        }),
        NgxUploaderModule,
    ],
    providers: [],
    bootstrap: [AppComponent],
})
export class AppModule {}
