import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PageNotFoundComponent } from './shared/components';
import { PlaylistUploaderComponent } from './playlist-uploader/playlist-uploader.component';
import { VideoPlayerComponent } from './video-player/video-player.component';

const routes: Routes = [
    {
        path: '',
        component: PlaylistUploaderComponent,
    },
    {
        path: 'iptv',
        component: VideoPlayerComponent,
    },
    {
        path: 'settings',
        loadChildren: () =>
            import('./settings/settings.module').then((m) => m.SettingsModule),
    },
    {
        path: '**',
        component: PageNotFoundComponent,
    },
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule],
})
export class AppRoutingModule {}
