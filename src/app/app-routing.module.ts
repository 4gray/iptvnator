import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
    {
        path: '',
        loadChildren: () =>
            import('./home/home.module').then((m) => m.HomeModule),
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
        path: '**',
        redirectTo: '',
    },
];

@NgModule({
    imports: [RouterModule.forRoot(routes, {})],
    exports: [RouterModule],
})
export class AppRoutingModule {}
