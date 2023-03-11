# [0.12.0](https://github.com/4gray/iptvnator/compare/v0.11.1...v0.12.0) (2023-03-11)


### Important change

The storage location of playlists has been changed, now everything is stored in IndexedDB. So after the update you will see a panel offering to migrate playlists.

### Bug Fixes

* macos related window management improvements ([b336680](https://github.com/4gray/iptvnator/commit/**b336680ec93b6c2a78af08bf1847f6e133895719**))
* set epgSource as not required field ([049ed6b](https://github.com/4gray/iptvnator/commit/049ed6be519df602fd8eb5071fb17efe1a850000)), closes [#175](https://github.com/4gray/iptvnator/issues/175)


### Features

* add cmd+q hotkey to close the app (macOS) ([f3e00e7](https://github.com/4gray/iptvnator/commit/f3e00e78aa65b64d058c27b616b0d11d1a374015)), closes [#181](https://github.com/4gray/iptvnator/issues/181)
* add dockerfile and docker-compose ([4b97e3d](https://github.com/4gray/iptvnator/commit/4b97e3d4b3b84a57c5c09cc25c0c362de341e2ba))
* add italian language ([3e3f18c](https://github.com/4gray/iptvnator/commit/3e3f18cabf3784bcfee17e54771ca0a5dbcbbf33))
* draggable channels in favorites list ([ba41c8d](https://github.com/4gray/iptvnator/commit/ba41c8dae5e82bd1f39fb9a6cd8518e25dcdb894))
* export playlist as m3u ([7e4d6b1](https://github.com/4gray/iptvnator/commit/7e4d6b171fa87ffb7084344a10d653dd2cb30ea2))
* persist window size ([2ce60e0](https://github.com/4gray/iptvnator/commit/2ce60e0a205dd8034626f35bfea1632fcac56529)), closes [#205](https://github.com/4gray/iptvnator/issues/205)
* **pwa:** load a m3u playlist as a URL parameter [#176](https://github.com/4gray/iptvnator/issues/176) ([344bd75](https://github.com/4gray/iptvnator/commit/344bd75c876ff3d26e5721e64e7b35cf7547950a))



## [0.11.1](https://github.com/4gray/iptvnator/compare/v0.11.0...v0.11.1) (2022-10-01)


### Bug Fixes

* allow file:// protocol for epg source ([c4e1076](https://github.com/4gray/iptvnator/commit/c4e107681e55ac168a86b57cf0c6bfd5a2b35c5c))
* disable service worker in electron app ([df4e99a](https://github.com/4gray/iptvnator/commit/df4e99a4ae7186322eddcab8b6a81a04bd4c2e1a))
* red screen in PIP window ([9756a76](https://github.com/4gray/iptvnator/commit/9756a76a90c05c008cd84c690c82b04c7ec56c87))
* service worker injection ([ba3dd88](https://github.com/4gray/iptvnator/commit/ba3dd88dde1129ac21ec6056b81f7ff8b569f5d6))


### Reverts

* Revert "Update release.yml" ([5ac1992](https://github.com/4gray/iptvnator/commit/5ac199281d0fa24998cf01dff148316f7684e46a))



# [0.11.0](https://github.com/4gray/iptvnator/compare/v0.10.0...v0.11.0) (2022-09-11)


### Bug Fixes

* set default value for video player ([ab1d0bf](https://github.com/4gray/iptvnator/commit/ab1d0bfec85dd8a43606c02a215c6654b809bb15))
* show notification after playlist refresh (PWA) ([b18e537](https://github.com/4gray/iptvnator/commit/b18e537ccb25c49002577a7aedd810c81eb981ea))


### Features

* check for available updates in PWA ([17b265f](https://github.com/4gray/iptvnator/commit/17b265f5a6bc4cae5c66532ccda3af580b52779c))
* implement multi epg view ([b4db751](https://github.com/4gray/iptvnator/commit/b4db751fb66353700dbc9e2285232da28ee655cb))
* import playlist as text ([6676fa0](https://github.com/4gray/iptvnator/commit/6676fa0a4267a5cb56697b47f24954581873f3e1))
* support multiple epg sources ([f8c6874](https://github.com/4gray/iptvnator/commit/f8c6874ad3734ef74e5de25e83626c7e8e77c55a))



# [0.10.0](https://github.com/4gray/iptvnator/compare/v0.9.0...v0.10.0) (2022-04-24)


### Bug Fixes

* capitalize app name [#117](https://github.com/4gray/iptvnator/issues/117) ([36d3eaa](https://github.com/4gray/iptvnator/commit/36d3eaa54d546de64a9522583772cf411a2866c4))
* epg function to compare channel ids ([c7de39e](https://github.com/4gray/iptvnator/commit/c7de39e7c4fa46d9d09adb34a88a060fa9570ea6))


### Features

* add context menu with default actions ([44e76e0](https://github.com/4gray/iptvnator/commit/44e76e0e35eccc085c9b35ddd3a112b6c1aa8e09)), closes [#96](https://github.com/4gray/iptvnator/issues/96)
* add option to change aspect ratio ([b8a3f76](https://github.com/4gray/iptvnator/commit/b8a3f76c40f44416eb69b7ab0d99bf6ad3b5307b)), closes [#80](https://github.com/4gray/iptvnator/issues/80)
* add option to select stream resolution ([c23fe3a](https://github.com/4gray/iptvnator/commit/c23fe3a923ff5b60930f9968ec9cfb611b552858)), closes [#93](https://github.com/4gray/iptvnator/issues/93)
* add pwa support ([5a5085d](https://github.com/4gray/iptvnator/commit/5a5085dcf7e7ba956c02db539160bb06ebce5e80))
* auto-detect if OS is in dark mode ([ad26588](https://github.com/4gray/iptvnator/commit/ad265884e6976ad4ddc636434bf97bc3e02c7613))
* generate global playlist with all favorites ([764201a](https://github.com/4gray/iptvnator/commit/764201a0afa03b0ed3c075e3c3cfcf6fba5c105a)), closes [#97](https://github.com/4gray/iptvnator/issues/97)
* integrate french localization ([ab75a2f](https://github.com/4gray/iptvnator/commit/ab75a2f83752ccebd07ca0dd13e9ded1e58e0efc))
* **pwa:** auto-generate playlist with global favorites ([98ff7f4](https://github.com/4gray/iptvnator/commit/98ff7f4fa4576e00d3de0afd05395f673622ddd8))
* switch playlists from the sidebar ([0bc71d4](https://github.com/4gray/iptvnator/commit/0bc71d47911c9b87cbe92f20f7d024c0027349e1))



# [0.9.0](https://github.com/4gray/iptvnator/compare/v0.8.0...v0.9.0) (2021-10-14)


### Bug Fixes

* search feature should not affect favorites list ([ef52f77](https://github.com/4gray/iptvnator/commit/ef52f77c117c644c2173d4b82783028a19f25011)), closes [#71](https://github.com/4gray/iptvnator/issues/71)


### Features

* add chinese translation ([a497f05](https://github.com/4gray/iptvnator/commit/a497f0570175618d7053b53fd47aa907e6361f17))
* global subtitle display setting ([4d2e175](https://github.com/4gray/iptvnator/commit/4d2e17565d247c2a6bc9ae3d23ab37ff52033478))
* rearrange the display order of playlists ([757c739](https://github.com/4gray/iptvnator/commit/757c739d92d0a646f1927a4c3f2d3eb8425876df)), closes [#77](https://github.com/4gray/iptvnator/issues/77)



# [0.8.0](https://github.com/4gray/iptvnator/compare/v0.7.0...v0.8.0) (2021-07-17)


### Features

* add info popup with epg info for active channel ([0eecfd1](https://github.com/4gray/iptvnator/commit/0eecfd1163a36019a7b600290fe5f01ee3bb9677)), closes [#51](https://github.com/4gray/iptvnator/issues/51)
* add support of specific user-agent and referer on channel level ([a55f741](https://github.com/4gray/iptvnator/commit/a55f741a320db430987352289fd7847e050dcafd)), closes [#57](https://github.com/4gray/iptvnator/issues/57)



# [0.7.0](https://github.com/4gray/iptvnator/compare/v0.6.0...v0.7.0) (2021-05-24)


### Bug Fixes

* promise issue after channel switch [#29](https://github.com/4gray/iptvnator/issues/29) ([d1f194a](https://github.com/4gray/iptvnator/commit/d1f194a25e231fd39f73aae8da7fccf60e7d4826))


### Features

* auto-refresh playlists on app startup ([e8ab576](https://github.com/4gray/iptvnator/commit/e8ab576d8b797a39eb1206e80f19e04abe88bdb4))
* refresh playlist from file system or imported url ([57cf247](https://github.com/4gray/iptvnator/commit/57cf2477d9f3d423eb4ebbd983488b4ade275411))
* support of timeshift and catchup attributes in playlists ([ced16a8](https://github.com/4gray/iptvnator/commit/ced16a88b25c9cb139d3a70ed1194a977cfb07f1))



# [0.6.0](https://github.com/4gray/iptvnator/compare/v0.5.0...v0.6.0) (2021-04-10)


### Bug Fixes

* quit application via window close icon ([24d5584](https://github.com/4gray/iptvnator/commit/24d558470251d479b611a22bfa7f1b7ba0c70a45)), closes [#33](https://github.com/4gray/iptvnator/issues/33)


### Features

* add "what is new" dialog ([cc375a4](https://github.com/4gray/iptvnator/commit/cc375a4d4e068ec6cd23deeb83135fe8b773e517))
* add dark theme ([0cf010a](https://github.com/4gray/iptvnator/commit/0cf010aba31b9e7b8a3344787b7c18bb67405ab7))
* add dialog with detailed epg description ([96e93c5](https://github.com/4gray/iptvnator/commit/96e93c5b0cf1b8d9e703d93c66a1ad552ab44ed8))
* set custom user agent for a playlist ([a8167c4](https://github.com/4gray/iptvnator/commit/a8167c4b2ae625f9714c8bbe5cd6ffa3fcfa0140)), closes [#26](https://github.com/4gray/iptvnator/issues/26)
* show channel logos in the list ([41998ff](https://github.com/4gray/iptvnator/commit/41998ff7a0800368ef64ba184e4bab1b02f509c0)), closes [#28](https://github.com/4gray/iptvnator/issues/28)



# [0.5.0](https://github.com/4gray/iptvnator/compare/v0.4.0...v0.5.0) (2021-02-28)


### Bug Fixes

* less strict url validation of playlist URL ([4f366d9](https://github.com/4gray/iptvnator/commit/4f366d91fd5664787b2258f30a25cb0d3d58b30e)), closes [#22](https://github.com/4gray/iptvnator/issues/22)
* macOS corrupt icon fix, closes [#21](https://github.com/4gray/iptvnator/issues/21) ([955bb27](https://github.com/4gray/iptvnator/commit/955bb27eec4267a954246415fa1234dd4cd2b08c))


### Features

* add dialog about playlist details ([9f951fa](https://github.com/4gray/iptvnator/commit/9f951fa0174e4548c57f7a5392d4d74587ac2023))
* add german language (i18n) ([7888e85](https://github.com/4gray/iptvnator/commit/7888e85ff106176fff3951ec9e9a056e787d28e5))
* add internationalization ([0f8ca2a](https://github.com/4gray/iptvnator/commit/0f8ca2ab1a618dfc3e273ddadfdb51c251912642))
* add russian language (i18n) ([a93af69](https://github.com/4gray/iptvnator/commit/a93af690eea075092ae9a987531af01cd3d9a415))



# [0.4.0](https://github.com/4gray/iptvnator/compare/v0.3.0...v0.4.0) (2021-02-11)


### Bug Fixes

* default html5 player initialization fix ([4a6b976](https://github.com/4gray/iptvnator/commit/4a6b9761902fb694677980874ad3dc4a985e4c90))


### Features

* add `ctrl+f` as hotkey to focus search field ([cad162d](https://github.com/4gray/iptvnator/commit/cad162dc6700a9543571ef051b24d123d41fe9f9))
* add epg worker with new ipc commands ([418566f](https://github.com/4gray/iptvnator/commit/418566f6317960e83edff117a036b54df2eac07b))
* add moment.js based date pipe ([4881ba8](https://github.com/4gray/iptvnator/commit/4881ba8fe073fd425942773e04bbc98bb7d02aaa))
* check for available update ([68ccabb](https://github.com/4gray/iptvnator/commit/68ccabbcb110295aa46a88b1c6c70d057ffaef66))
* epg integration ([2e861b6](https://github.com/4gray/iptvnator/commit/2e861b6a1f2c0744bc1eaae632a79087d1721f41))
* **epg:** epg program list with date navigation ([fdbe02b](https://github.com/4gray/iptvnator/commit/fdbe02b47e400cdad0c6e0294579150590ac5c14))
* favorite channels list ([f02bbe3](https://github.com/4gray/iptvnator/commit/f02bbe39a66a12fd1d3b12863aa2b32048b7691f))
* integrate epg feature ([e896af0](https://github.com/4gray/iptvnator/commit/e896af037303990c95d95efac7296365e8c714ee))
* integrate epg worker & refactor app menu ([3b97d74](https://github.com/4gray/iptvnator/commit/3b97d74e0b39b20d62f4b2911fe0af1a7c70891b))
* sort playlists by import date ([d967b12](https://github.com/4gray/iptvnator/commit/d967b121008075751f47bbd4898894571ef38152))
* validation of playlist url ([da2fe5e](https://github.com/4gray/iptvnator/commit/da2fe5e6bfdf09b1feaf7aa4db6240f962555870))


### Performance Improvements

* destroy hls instance after view change ([2e3681c](https://github.com/4gray/iptvnator/commit/2e3681c36edb9e95509d510ab445ab3d95bb4328))



# [0.2.0](https://github.com/4gray/iptvnator/compare/v0.1.0...v0.2.0) (2020-09-27)


### Features

* add new video.js based player ([1e852e3](https://github.com/4gray/iptvnator/commit/1e852e389931e18ccfaf78f21c86df5dfe81ad6d))
* add settings page ([1a44ecd](https://github.com/4gray/iptvnator/commit/1a44ecd995d212e9597c44353fa049e4f07f0ab7))
* video player configuration in app settings ([05c0c25](https://github.com/4gray/iptvnator/commit/05c0c251cf92ad17788628f5c8d8d8107e935d94))



# [0.1.0](https://github.com/4gray/iptvnator/compare/v0.0.2...v0.1.0) (2020-09-12)


### Bug Fixes

* playlist upload for mac os [#6](https://github.com/4gray/iptvnator/issues/6) ([78ca56f](https://github.com/4gray/iptvnator/commit/78ca56f2b64ca61d7acdce0038d1210e99b07ffc))


### Features

* add new application icon ([0ce0b1f](https://github.com/4gray/iptvnator/commit/0ce0b1f1b5222470c79e666f6be92f507dc2f68d))
* open playlist from file system ([861e480](https://github.com/4gray/iptvnator/commit/861e480b7076fe0e02f96908f4f30ac626722a9a))



## [0.0.2](https://github.com/4gray/iptvnator/compare/v0.0.1...v0.0.2) (2020-09-06)


### Bug Fixes

* define path to userData folder as db store ([8e8c107](https://github.com/4gray/iptvnator/commit/8e8c107ca78d30bc6e90c6894fc021b1ee83d5ea))
* enable copy-paste hotkeys for mac os ([4357c17](https://github.com/4gray/iptvnator/commit/4357c172932231d50c33ee8bc7decfb5a73d9419))



## [0.0.1](https://github.com/4gray/iptvnator/compare/2f1701a3db04beb2fc6aca1e3a05f04c0a04b8af...v0.0.1) (2020-09-05)


### Bug Fixes

* full screen permissions ([fff2aaa](https://github.com/4gray/iptvnator/commit/fff2aaa5416cb29b12c60ff0cbe615e409689808))
* full screen permissions ([f0d0fb1](https://github.com/4gray/iptvnator/commit/f0d0fb1c31651106ae5a2e1e1920b0d6efdfb489))
* start_url fix in manifest file ([e05b7eb](https://github.com/4gray/iptvnator/commit/e05b7ebdfe58fe8b4bb8a169eaa8c0ab62947a32))
* start_url fix in manifest file ([3929655](https://github.com/4gray/iptvnator/commit/392965595581b38229975475562c839e30146920))
* update paths to make app installable ([fd9fc53](https://github.com/4gray/iptvnator/commit/fd9fc5360692030b4ce70eb9cdc44b79239a3fa8))
* update paths to make app installable ([4b7d1b5](https://github.com/4gray/iptvnator/commit/4b7d1b561ca04a8c0ed32a0b6a4ce48e695b310f))


### Features

* add channel search function ([d1b9461](https://github.com/4gray/iptvnator/commit/d1b94615f0d1a420d320babfc3e866dd2520cf72))
* add channel search function ([7a039af](https://github.com/4gray/iptvnator/commit/7a039af3f1e0619ce7a97622668705698380609a))
* add favorites and tab based navigation ([8d333d9](https://github.com/4gray/iptvnator/commit/8d333d95203ec4344f44df0678c70d6840ae1bb0))
* add favorites and tab based navigation ([c6e3e1f](https://github.com/4gray/iptvnator/commit/c6e3e1f02550b83914e284b95943bc05a53ad509))
* add icon, about dialog and menu ([bcf49b8](https://github.com/4gray/iptvnator/commit/bcf49b84c7626c3e87bbdab8ad382df4546f42e9))
* change sidebar mode ([22f2bc1](https://github.com/4gray/iptvnator/commit/22f2bc1df9a588d38e507c1a2b6a5b0a5aadd830))
* change sidebar mode ([ca9f7a2](https://github.com/4gray/iptvnator/commit/ca9f7a254b2551592cc543698b25d622bc262df6))
* electron based app ([0feb657](https://github.com/4gray/iptvnator/commit/0feb65786ab3caf7775195cc266a2789eb3093ed))
* electron based app ([998e7e9](https://github.com/4gray/iptvnator/commit/998e7e92557aff5cf86bd362abdde051275797b0))
* implement channel groups view ([20e0a40](https://github.com/4gray/iptvnator/commit/20e0a4019c6a3db09fa54a3118c67eb348787a18))
* implement channel groups view ([773e1ed](https://github.com/4gray/iptvnator/commit/773e1edf63df735d517fd11dda6dfd6b3181258f))
* initial commit ([79332aa](https://github.com/4gray/iptvnator/commit/79332aa6de5dd2a10fad187e809057e2cbac4abd))
* initial commit ([2f1701a](https://github.com/4gray/iptvnator/commit/2f1701a3db04beb2fc6aca1e3a05f04c0a04b8af))
* list with recent playlists ([1735026](https://github.com/4gray/iptvnator/commit/1735026c201591c4192317f3a5371c8548f8fa1c))
* list with recent playlists ([8ee96ee](https://github.com/4gray/iptvnator/commit/8ee96eeebe0ca422d7bc183296f896c49e827b19))



