import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { stalkerRoutes } from './stalker/stalker.routes';

const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./home/home.component').then((c) => c.HomeComponent),
    },
    {
        path: 'playlists',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'iptv',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'playlists/:id',
        loadComponent: () =>
            import('./home/video-player/video-player.component').then(
                (c) => c.VideoPlayerComponent
            ),
    },
    {
        path: 'settings',
        loadComponent: () =>
            import('./settings/settings.component').then(
                (c) => c.SettingsComponent
            ),
    },
    /* ...(!!window.electron
        ? xtreamRoutes
        : [
              {
                  path: 'xtreams/:id',
                  loadComponent: () =>
                      import('./xtream/xtream-main-container.component').then(
                          (c) => c.XtreamMainContainerComponent
                      ),
              },
          ]), */
    {
        path: 'portals/:id',
        loadComponent: () =>
            import('./stalker/stalker-main-container.component').then(
                (c) => c.StalkerMainContainerComponent
            ),
    },
    ...stalkerRoutes,
    {
        path: '**',
        redirectTo: '',
    },
];

@NgModule({
    imports: [
        RouterModule.forRoot(
            routes /* {
            enableTracing: !AppConfig.production,
        } */
        ),
    ],
    exports: [RouterModule],
})
export class AppRoutingModule {}
