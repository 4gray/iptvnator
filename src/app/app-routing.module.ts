import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./home/home.component').then((c) => c.HomeComponent),
    },
    {
        path: 'playlists',
        loadComponent: () =>
            import(
                './player/components/video-player/video-player.component'
            ).then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'iptv',
        loadComponent: () =>
            import(
                './player/components/video-player/video-player.component'
            ).then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'playlists/:id',
        loadComponent: () =>
            import(
                './player/components/video-player/video-player.component'
            ).then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'settings',
        loadComponent: () =>
            import('./settings/settings.component').then(
                (c) => c.SettingsComponent
            ),
    },
    {
        path: 'xtreams/:id',
        loadComponent: () =>
            import('./xtream/xtream-main-container.component').then(
                (c) => c.XtreamMainContainerComponent
            ),
    },
    {
        path: 'portals/:id',
        loadComponent: () =>
            import('./stalker/stalker-main-container.component').then(
                (c) => c.StalkerMainContainerComponent
            ),
    },
    {
        path: '**',
        redirectTo: '',
    },
];

@NgModule({
    imports: [RouterModule.forRoot(routes, {})],
    exports: [RouterModule],
})
export class AppRoutingModule {}
