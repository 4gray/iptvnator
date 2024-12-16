import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { isTauri } from '@tauri-apps/api/core';
import { XtreamStore } from './xtream-tauri/xtream.store';

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
    ...(isTauri()
        ? [
              {
                  path: 'xtreams/:id',
                  loadComponent: () =>
                      import(
                          './xtream-tauri/xtream-main-container.component'
                      ).then((c) => c.XtreamMainContainerComponent),
                  providers: [XtreamStore],
                  children: [
                      {
                          path: '',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/category-content-view/category-content-view.component'
                              ).then((c) => c.CategoryContentViewComponent),
                      },
                      {
                          path: 'favorites',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/favorites/favorites.component'
                              ).then((c) => c.FavoritesComponent),
                      },
                      {
                          path: 'recent',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/recently-viewed/recently-viewed.component'
                              ).then((c) => c.RecentlyViewedComponent),
                      },

                      {
                          path: 'search',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/search-results/search-results.component'
                              ).then((c) => c.SearchResultsComponent),
                      },
                      {
                          path: 'live',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/live-stream-layout/live-stream-layout.component'
                              ).then((c) => c.LiveStreamLayoutComponent),
                      },
                      {
                          path: ':categoryId',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/category-content-view/category-content-view.component'
                              ).then((c) => c.CategoryContentViewComponent),
                      },
                      {
                          path: ':categoryId/vod/:vodId',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/vod-details/vod-details.component'
                              ).then((c) => c.VodDetailsComponent),
                      },
                      {
                          path: ':categoryId/series/:serialId',
                          loadComponent: () =>
                              import(
                                  './xtream-tauri/serial-details/serial-details.component'
                              ).then((c) => c.SerialDetailsComponent),
                      },
                  ],
              },
          ]
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
    {
        path: '**',
        redirectTo: '',
    },
];

@NgModule({
    imports: [
        RouterModule.forRoot(
            routes /* {
            enableTracing: true,
        } */
        ),
    ],
    exports: [RouterModule],
})
export class AppRoutingModule {}
