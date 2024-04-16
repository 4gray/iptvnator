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
        loadChildren: () =>
            import('./player/player.module').then((m) => m.PlayerModule),
    },
    {
        path: 'iptv',
        loadChildren: () =>
            import('./player/player.module').then((m) => m.PlayerModule),
    },
    {
        path: 'playlists/:id',
        loadChildren: () =>
            import('./player/player.module').then((m) => m.PlayerModule),
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
