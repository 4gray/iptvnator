import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { isTauri } from '@tauri-apps/api/core';
import { stalkerRoutes } from './stalker/stalker.routes';
import { xtreamRoutes } from './xtream-tauri/xtream.routes';

const routes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./home/home.component').then((c) => c.HomeComponent),
    },
    {
        path: 'playlists',
        loadComponent: () =>
            import('components').then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'iptv',
        loadComponent: () =>
            import('components').then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'playlists/:id',
        loadComponent: () =>
            import('components').then((c) => c.VideoPlayerComponent),
    },
    {
        path: 'settings',
        loadComponent: () =>
            import('./settings/settings.component').then(
                (c) => c.SettingsComponent
            ),
    },
    ...(isTauri()
        ? xtreamRoutes
        : [
              {
                  path: 'xtreams/:id',
                  loadComponent: () =>
                      import('./xtream/xtream-main-container.component').then(
                          (c) => c.XtreamMainContainerComponent
                      ),
              },
          ]),
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
