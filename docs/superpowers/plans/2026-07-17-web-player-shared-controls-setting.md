# Web-Player Shared Controls Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted experimental Playback checkbox that enables the existing shared controls for newly created HTML5, Video.js, and ArtPlayer sessions without restarting IPTVnator.

**Architecture:** `SettingsStore` owns a default-off `webPlayerSharedControls` boolean and the Settings form exposes it only for the three web engines. `WebPlayerViewComponent` resolves the saved value into a component-scoped, immutable `WEB_PLAYER_SHARED_CONTROLS` snapshot, preserving each engine's construction-time legacy/shared split while leaving Embedded MPV and external players unchanged.

**Tech Stack:** Angular standalone components and reactive forms, NgRx Signal Store, Angular DI, Angular Material, ngx-translate JSON locales, Jest/TestBed, Playwright, Nx.

---

## File Map

### Settings contract and persistence

- Modify `libs/shared/interfaces/src/lib/settings.interface.ts`
    - Declare the optional persisted boolean.
- Modify `libs/services/src/lib/settings-store.service.ts`
    - Add the default, normalize stored input, and include the resolved value in
      complete settings serialization.
- Modify `libs/services/src/lib/settings-store.service.spec.ts`
    - Cover missing, enabled, malformed, and persisted values.

### Settings form and presentation

- Modify `apps/web/src/app/settings/settings-form.utils.ts`
    - Add the form control and form-to-settings mapping.
- Modify `apps/web/src/app/settings/settings-playback-section.component.ts`
    - Identify whether the selected engine is one of the three web players.
- Modify `apps/web/src/app/settings/settings-playback-section.component.html`
    - Render the conditional Material checkbox.
- Modify `apps/web/src/app/settings/settings-playback-section.component.spec.ts`
    - Cover visibility and checkbox binding.
- Modify `apps/web/src/app/settings/settings.component.spec.ts`
    - Keep the canonical test fixture shape current and verify hydration/save.
- Modify all JSON files under `apps/web/src/assets/i18n/`
    - Add the same two `SETTINGS` keys with localized values.

### Playback session wiring

- Modify `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
    - Provide an immutable, settings-backed controls token per player host.
- Modify
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.shared-controls.spec.ts`
    - Verify enabled/disabled resolution and per-host snapshot behavior.

### End-to-end coverage and documentation

- Modify `apps/web-e2e/src/settings.e2e.ts`
    - Verify browser persistence after Save and reload.
- Modify `apps/electron-backend-e2e/src/settings.e2e.ts`
    - Verify desktop persistence across restart and shared controls on the next
      HTML5 playback session.
- Modify `README.md`
    - Mention the optional unified built-in web-player controls.
- Modify `docs/architecture/player-controls-contract.md`
    - Replace compile-time-only rollout language with the persisted setting and
      per-session snapshot.
- Modify `AGENTS.md` and `CLAUDE.md`
    - Keep their shared-controls descriptions synchronized.

## Task 1: Persist the Default-Off Settings Contract

**Files:**

- Modify: `libs/shared/interfaces/src/lib/settings.interface.ts`
- Modify: `libs/services/src/lib/settings-store.service.ts`
- Test: `libs/services/src/lib/settings-store.service.spec.ts`

- [ ] **Step 1: Write failing store behavior tests**

Add these cases to `libs/services/src/lib/settings-store.service.spec.ts`.
The temporary intersections keep the red test compiling before the shared
interface declares the field:

```ts
it('defaults shared web controls to false when the stored field is missing', async () => {
    const store = injector.get(SettingsStore);

    await store.loadSettings();

    const settings = store.getSettings() as ReturnType<
        typeof store.getSettings
    > & {
        webPlayerSharedControls?: unknown;
    };
    expect(settings.webPlayerSharedControls).toBe(false);
});

it('restores an enabled shared web controls preference', async () => {
    storedSettings = {
        webPlayerSharedControls: true,
    } as Partial<Settings> & { webPlayerSharedControls: boolean };
    const store = injector.get(SettingsStore);

    await store.loadSettings();

    const settings = store.getSettings() as ReturnType<
        typeof store.getSettings
    > & {
        webPlayerSharedControls?: unknown;
    };
    expect(settings.webPlayerSharedControls).toBe(true);
});

it('normalizes a malformed shared web controls preference to false', async () => {
    storedSettings = {
        webPlayerSharedControls: 'enabled',
    } as unknown as Partial<Settings>;
    const store = injector.get(SettingsStore);

    await store.loadSettings();

    const settings = store.getSettings() as ReturnType<
        typeof store.getSettings
    > & {
        webPlayerSharedControls?: unknown;
    };
    expect(settings.webPlayerSharedControls).toBe(false);
});

it('persists the resolved shared web controls preference', async () => {
    const store = injector.get(SettingsStore);

    await store.updateSettings({
        webPlayerSharedControls: true,
    } as Partial<Settings> & { webPlayerSharedControls: boolean });

    expect(storage.set).toHaveBeenCalledWith(
        STORE_KEY.Settings,
        expect.objectContaining({
            webPlayerSharedControls: true,
        })
    );
});
```

- [ ] **Step 2: Run the focused store test and verify the red state**

Run:

```bash
pnpm nx test services --skip-nx-cache --runInBand \
  --testPathPatterns=settings-store.service.spec
```

Expected: FAIL because `getSettings()` omits
`webPlayerSharedControls`, and the preference is not persisted.

- [ ] **Step 3: Add the shared settings field**

Add this property beside `player` in
`libs/shared/interfaces/src/lib/settings.interface.ts`:

```ts
/**
 * Use IPTVnator's shared controls in HTML5, Video.js, and ArtPlayer.
 * Missing values remain off for compatibility with older saved settings.
 */
webPlayerSharedControls?: boolean;
```

- [ ] **Step 4: Normalize and serialize the setting**

In `libs/services/src/lib/settings-store.service.ts`, add the default:

```ts
webPlayerSharedControls: false,
```

Insert it immediately after `player: VideoPlayer.VideoJs` in
`DEFAULT_SETTINGS`. After `...storedSettings` in `loadSettings()`, override
untrusted stored input with an exact boolean:

```ts
patchState(store, {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    webPlayerSharedControls: storedSettings.webPlayerSharedControls === true,
    dashboardRails: normalizeDashboardRailsSettings(
        storedSettings.dashboardRails
    ),
});
```

Include the resolved field in `getSettings()`:

```ts
webPlayerSharedControls:
    store.webPlayerSharedControls?.() === true,
```

Insert it immediately after `player: store.player()`.

Once the interface exists, simplify the four new tests to use direct typed
access and typed updates:

```ts
expect(store.getSettings().webPlayerSharedControls).toBe(false);
expect(store.getSettings().webPlayerSharedControls).toBe(true);
await store.updateSettings({ webPlayerSharedControls: true });
```

Keep the `unknown as Partial<Settings>` cast only in the malformed-value test.

- [ ] **Step 5: Run contract and store tests**

Run:

```bash
pnpm nx build shared-interfaces
pnpm nx test services --skip-nx-cache --runInBand \
  --testPathPatterns=settings-store.service.spec
```

Expected: both commands PASS; missing/malformed values resolve to `false`, and
`true` is restored and persisted.

- [ ] **Step 6: Commit the settings contract**

```bash
git add libs/shared/interfaces/src/lib/settings.interface.ts \
  libs/services/src/lib/settings-store.service.ts \
  libs/services/src/lib/settings-store.service.spec.ts
git commit -m "feat(settings): persist shared web controls preference"
```

## Task 2: Add the Conditional Playback Checkbox

**Files:**

- Modify: `apps/web/src/app/settings/settings-form.utils.ts`
- Modify: `apps/web/src/app/settings/settings-playback-section.component.ts`
- Modify: `apps/web/src/app/settings/settings-playback-section.component.html`
- Test: `apps/web/src/app/settings/settings-playback-section.component.spec.ts`
- Test: `apps/web/src/app/settings/settings.component.spec.ts`
- Modify: `apps/web/src/assets/i18n/ar.json`
- Modify: `apps/web/src/assets/i18n/ary.json`
- Modify: `apps/web/src/assets/i18n/by.json`
- Modify: `apps/web/src/assets/i18n/de.json`
- Modify: `apps/web/src/assets/i18n/el.json`
- Modify: `apps/web/src/assets/i18n/en.json`
- Modify: `apps/web/src/assets/i18n/es.json`
- Modify: `apps/web/src/assets/i18n/fr.json`
- Modify: `apps/web/src/assets/i18n/it.json`
- Modify: `apps/web/src/assets/i18n/ja.json`
- Modify: `apps/web/src/assets/i18n/ko.json`
- Modify: `apps/web/src/assets/i18n/nl.json`
- Modify: `apps/web/src/assets/i18n/pl.json`
- Modify: `apps/web/src/assets/i18n/pt.json`
- Modify: `apps/web/src/assets/i18n/ru.json`
- Modify: `apps/web/src/assets/i18n/tr.json`
- Modify: `apps/web/src/assets/i18n/zh.json`
- Modify: `apps/web/src/assets/i18n/zhtw.json`

- [ ] **Step 1: Write failing visibility and binding tests**

Add `webPlayerSharedControls` to the local `createForm()` helper in
`settings-playback-section.component.spec.ts`:

```ts
webPlayerSharedControls: new FormControl(false),
```

Add the following tests:

```ts
it.each([VideoPlayer.VideoJs, VideoPlayer.Html5Player, VideoPlayer.ArtPlayer])(
    'shows shared controls for the %s web player',
    (player) => {
        fixture.componentRef.setInput('form', createForm(player));
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="web-player-shared-controls-setting"]'
            )
        ).not.toBeNull();
    }
);

it.each([VideoPlayer.EmbeddedMpv, VideoPlayer.MPV, VideoPlayer.VLC])(
    'hides shared web controls for the %s player',
    (player) => {
        fixture.componentRef.setInput('form', createForm(player));
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="web-player-shared-controls-setting"]'
            )
        ).toBeNull();
    }
);

it('binds the shared controls checkbox to the settings form', () => {
    const form = createForm(VideoPlayer.VideoJs);
    form.controls['webPlayerSharedControls'].setValue(true);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    expect(
        fixture.nativeElement.querySelector<HTMLInputElement>(
            '[data-test-id="web-player-shared-controls-toggle"] input[type="checkbox"]'
        )?.checked
    ).toBe(true);
});
```

In `settings.component.spec.ts`, add this field to `DEFAULT_SETTINGS`:

```ts
webPlayerSharedControls: false,
```

Add explicit hydration and save assertions:

```ts
it('hydrates the shared web controls preference', () => {
    const mockStore = settingsStore as unknown as MockSettingsStore;
    mockStore._setSettings({
        webPlayerSharedControls: true,
    });

    component.setSettings();

    expect(component.settingsForm.get('webPlayerSharedControls')?.value).toBe(
        true
    );
});

it('saves the shared web controls preference', async () => {
    const mockStore = settingsStore as unknown as MockSettingsStore;
    mockStore.updateSettings.mockResolvedValue(undefined);

    component.settingsForm.get('webPlayerSharedControls')?.setValue(true);
    component.onSubmit();
    await fixture.whenStable();

    expect(mockStore.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
            webPlayerSharedControls: true,
        })
    );
});
```

- [ ] **Step 2: Run focused web tests and verify the red state**

Run:

```bash
pnpm nx test web --skip-nx-cache --runInBand \
  --testPathPatterns='settings-playback-section.component.spec|settings.component.spec'
```

Expected: FAIL because the production form and Playback section do not yet
declare or render the preference.

- [ ] **Step 3: Add form hydration and serialization**

In `createSettingsForm()` in
`apps/web/src/app/settings/settings-form.utils.ts`, add:

```ts
webPlayerSharedControls: false,
```

Insert it immediately after the existing `player` control.

In `createSettingsFromFormValue()`, add:

```ts
webPlayerSharedControls: value.webPlayerSharedControls ?? false,
```

Insert it immediately after the existing `player` mapping.

The existing `SettingsComponent.setSettings()` `patchValue()` call then
hydrates the checkbox without a new component-specific code path.

- [ ] **Step 4: Add the selected-engine predicate and checkbox**

Add this method to
`apps/web/src/app/settings/settings-playback-section.component.ts`:

```ts
isWebPlayerSelected(): boolean {
    const player = this.form().value.player;
    return (
        player === VideoPlayer.VideoJs ||
        player === VideoPlayer.Html5Player ||
        player === VideoPlayer.ArtPlayer
    );
}
```

Insert this row in
`apps/web/src/app/settings/settings-playback-section.component.html` after the
stream-format selector:

```html
@if (isWebPlayerSelected()) {
<div class="setting-item" data-test-id="web-player-shared-controls-setting">
    <div class="setting-item__meta">
        <h4>{{ 'SETTINGS.WEB_PLAYER_SHARED_CONTROLS' | translate }}</h4>
        <p>
            {{ 'SETTINGS.WEB_PLAYER_SHARED_CONTROLS_DESCRIPTION' | translate }}
        </p>
    </div>
    <div class="setting-item__control setting-item__toggle">
        <mat-checkbox
            formControlName="webPlayerSharedControls"
            data-test-id="web-player-shared-controls-toggle"
        ></mat-checkbox>
    </div>
</div>
}
```

- [ ] **Step 5: Run focused web tests and verify the green state**

Run:

```bash
pnpm nx test web --skip-nx-cache --runInBand \
  --testPathPatterns='settings-playback-section.component.spec|settings.component.spec'
```

Expected: PASS for all three visible web players, all three hidden non-web
players, form hydration, and Save serialization.

- [ ] **Step 6: Add exact locale values**

Add `WEB_PLAYER_SHARED_CONTROLS` and
`WEB_PLAYER_SHARED_CONTROLS_DESCRIPTION` beside
`VIDEO_PLAYER_DESCRIPTION` inside `SETTINGS` in all 18 locale files:

| Locale | `WEB_PLAYER_SHARED_CONTROLS`                                           | `WEB_PLAYER_SHARED_CONTROLS_DESCRIPTION`                                                 |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `en`   | Unified controls for web players (experimental)                        | Use IPTVnator's shared controls in HTML5, Video.js, and ArtPlayer.                       |
| `ru`   | Единые элементы управления для веб-плееров (экспериментально)          | Использовать общие элементы управления IPTVnator в HTML5, Video.js и ArtPlayer.          |
| `de`   | Einheitliche Steuerung für Web-Player (experimentell)                  | Verwendet die gemeinsamen IPTVnator-Steuerelemente in HTML5, Video.js und ArtPlayer.     |
| `es`   | Controles unificados para reproductores web (experimental)             | Usa los controles compartidos de IPTVnator en HTML5, Video.js y ArtPlayer.               |
| `fr`   | Commandes unifiées pour les lecteurs web (expérimental)                | Utilise les commandes partagées d’IPTVnator dans HTML5, Video.js et ArtPlayer.           |
| `it`   | Controlli unificati per i player web (sperimentale)                    | Usa i controlli condivisi di IPTVnator in HTML5, Video.js e ArtPlayer.                   |
| `pt`   | Controlos unificados para leitores web (experimental)                  | Usa os controlos partilhados do IPTVnator em HTML5, Video.js e ArtPlayer.                |
| `nl`   | Uniforme bediening voor webspelers (experimenteel)                     | Gebruik de gedeelde IPTVnator-bediening in HTML5, Video.js en ArtPlayer.                 |
| `pl`   | Ujednolicone sterowanie odtwarzaczami internetowymi (eksperymentalne)  | Używaj wspólnych elementów sterowania IPTVnator w HTML5, Video.js i ArtPlayer.           |
| `tr`   | Web oynatıcıları için birleşik kontroller (deneysel)                   | HTML5, Video.js ve ArtPlayer'da IPTVnator'ın ortak kontrollerini kullan.                 |
| `el`   | Ενοποιημένα στοιχεία ελέγχου για web players (πειραματικό)             | Χρησιμοποιήστε τα κοινά στοιχεία ελέγχου του IPTVnator σε HTML5, Video.js και ArtPlayer. |
| `ja`   | Webプレーヤーの統一コントロール（試験的）                              | HTML5、Video.js、ArtPlayerでIPTVnator共通のコントロールを使用します。                    |
| `ko`   | 웹 플레이어 통합 컨트롤(실험적)                                        | HTML5, Video.js 및 ArtPlayer에서 IPTVnator 공통 컨트롤을 사용합니다.                     |
| `zh`   | Web 播放器统一控件（实验性）                                           | 在 HTML5、Video.js 和 ArtPlayer 中使用 IPTVnator 的共享控件。                            |
| `zhtw` | Web 播放器統一控制項（實驗性）                                         | 在 HTML5、Video.js 和 ArtPlayer 中使用 IPTVnator 的共用控制項。                          |
| `ar`   | عناصر تحكم موحّدة لمشغلات الويب (تجريبي)                               | استخدم عناصر التحكم المشتركة في IPTVnator مع HTML5 وVideo.js وArtPlayer.                 |
| `ary`  | عناصر تحكم موحدة لمشغلات الويب (تجريبية)                               | استعمل عناصر التحكم المشتركة ديال IPTVnator مع HTML5 وVideo.js وArtPlayer.               |
| `by`   | Адзіныя элементы кіравання для вэб-прайгравальнікаў (эксперыментальна) | Выкарыстоўваць агульныя элементы кіравання IPTVnator у HTML5, Video.js і ArtPlayer.      |

- [ ] **Step 7: Validate locale parity and the full Settings project**

Run:

```bash
pnpm run i18n:check
pnpm nx test web --skip-nx-cache
pnpm nx lint web --skip-nx-cache
```

Expected: all commands PASS, with no missing or extra locale keys.

- [ ] **Step 8: Commit the Settings UI**

```bash
git add apps/web/src/app/settings/settings-form.utils.ts \
  apps/web/src/app/settings/settings-playback-section.component.ts \
  apps/web/src/app/settings/settings-playback-section.component.html \
  apps/web/src/app/settings/settings-playback-section.component.spec.ts \
  apps/web/src/app/settings/settings.component.spec.ts \
  apps/web/src/assets/i18n
git commit -m "feat(settings): expose shared web controls toggle"
```

## Task 3: Resolve an Immutable Controls Mode per Player Host

**Files:**

- Modify: `libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`
- Test:
  `libs/ui/playback/src/lib/web-player-view/web-player-view.component.shared-controls.spec.ts`

- [ ] **Step 1: Write a failing host-provider test**

Update the Angular import in
`web-player-view.component.shared-controls.spec.ts`:

```ts
import { Component, input, output, signal } from '@angular/core';
```

Import the store and rollout token:

```ts
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
```

Add a mutable mock signal beside the suite variables:

```ts
const webPlayerSharedControls = signal(false);
```

Reset and provide it in `beforeEach()`:

```ts
webPlayerSharedControls.set(false);

{
    provide: SettingsStore,
    useValue: { webPlayerSharedControls },
},
```

Insert the provider object into the existing TestBed `providers` array.

Add this test:

```ts
it('snapshots the saved shared-controls mode for each player host', () => {
    webPlayerSharedControls.set(true);
    fixture.detectChanges();

    expect(fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)).toBe(
        true
    );

    webPlayerSharedControls.set(false);
    expect(fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)).toBe(
        true
    );

    fixture.destroy();
    fixture = TestBed.createComponent(WebPlayerViewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput(
        'streamUrl',
        'https://example.com/new-session.ts'
    );
    fixture.detectChanges();

    expect(fixture.debugElement.injector.get(WEB_PLAYER_SHARED_CONTROLS)).toBe(
        false
    );
});
```

This proves both required properties: Save affects the next host, and an
existing host does not mix construction modes.

- [ ] **Step 2: Run the host test and verify the red state**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns=web-player-view.component.shared-controls
```

Expected: FAIL because the root token still resolves the compile-time `false`
constant instead of the `SettingsStore` signal.

- [ ] **Step 3: Add the component-scoped token provider**

Update the services import in
`libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts`:

```ts
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
```

Import the rollout symbols:

```ts
import {
    WEB_PLAYER_SHARED_CONTROLS,
    WEB_PLAYER_SHARED_CONTROLS_ENABLED,
} from '../player-controls';
```

Add a focused factory before the component decorator:

```ts
function resolveWebPlayerSharedControls(): boolean {
    const storedValue = inject(SettingsStore).webPlayerSharedControls?.();

    return typeof storedValue === 'boolean'
        ? storedValue
        : WEB_PLAYER_SHARED_CONTROLS_ENABLED;
}
```

Add the component-scoped provider:

```ts
providers: [
    {
        provide: WEB_PLAYER_SHARED_CONTROLS,
        useFactory: resolveWebPlayerSharedControls,
    },
],
```

Insert this property into the existing `@Component` metadata.

Angular creates and caches this primitive in the `WebPlayerViewComponent`
element injector. HTML5, Video.js, and ArtPlayer descendants receive one
immutable value for their shared construction-time branch. Embedded MPV does
not inject this token and therefore remains engine-driven.

- [ ] **Step 4: Run focused and complete playback tests**

Run:

```bash
pnpm nx test ui-playback --skip-nx-cache --runInBand \
  --testPathPatterns='web-player-view.component|web-player-controls.flag'
pnpm nx test ui-playback --skip-nx-cache
pnpm nx lint ui-playback --skip-nx-cache
```

Expected: all commands PASS. Existing engine suites continue to prove that
flag-off preserves vendor controls and flag-on mounts exactly one shared UI.

- [ ] **Step 5: Commit the playback wiring**

```bash
git add libs/ui/playback/src/lib/web-player-view/web-player-view.component.ts \
  libs/ui/playback/src/lib/web-player-view/web-player-view.component.shared-controls.spec.ts
git commit -m "feat(playback): resolve shared controls from settings"
```

## Task 4: Prove Persistence and Next-Session Activation End to End

**Files:**

- Modify: `apps/web-e2e/src/settings.e2e.ts`
- Modify: `apps/electron-backend-e2e/src/settings.e2e.ts`

- [ ] **Step 1: Add browser Save/reload persistence coverage**

Add this test to `apps/web-e2e/src/settings.e2e.ts`:

```ts
test('@settings @web Enable shared web player controls', async ({ page }) => {
    await openSettings(page);

    const setting = page.locator(
        '[data-test-id="web-player-shared-controls-setting"]'
    );
    const checkbox = setting.locator('input[type="checkbox"]');

    await expect(setting).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await saveSettings(page);

    await page.reload();
    await openSettings(page);

    await expect(checkbox).toBeChecked();
});
```

- [ ] **Step 2: Extend the Electron restart-persistence test**

In the existing
`persists changed desktop settings across app restart` test, immediately after
selecting `html5`, enable the new checkbox:

```ts
const sharedControlsCheckbox = firstLaunch.mainWindow
    .getByTestId('web-player-shared-controls-setting')
    .locator('input[type="checkbox"]');
await expect(sharedControlsCheckbox).toBeVisible();
await sharedControlsCheckbox.check();
```

After the second launch confirms that HTML5 is selected, assert:

```ts
await expect(
    secondLaunch.mainWindow
        .getByTestId('web-player-shared-controls-setting')
        .locator('input[type="checkbox"]')
).toBeChecked();
```

- [ ] **Step 3: Add a desktop next-session playback smoke test**

Add this test to `apps/electron-backend-e2e/src/settings.e2e.ts`:

```ts
test('@settings @playback @electron applies shared controls to the next HTML5 session', async ({
    dataDir,
}) => {
    const app = await launchElectronApp(dataDir);

    try {
        await openSettings(app.mainWindow);
        await selectSettingsOption(
            app.mainWindow,
            'select-video-player',
            'html5'
        );
        await app.mainWindow
            .getByTestId('web-player-shared-controls-setting')
            .locator('input[type="checkbox"]')
            .check();
        await saveSettings(app.mainWindow);

        await goToDashboard(app.mainWindow);
        await importM3uPlaylistFromNativeDialog(app, m3uFixturePath);
        await app.mainWindow.waitForURL(/\/workspace\/playlists\/.+/);

        const firstChannel = channelItemByTitle(
            app.mainWindow,
            'Channel 1'
        ).first();
        await expect(firstChannel).toBeVisible({ timeout: 20000 });
        await firstChannel.click();

        await expect(
            app.mainWindow.locator('app-html-video-player app-player-controls')
        ).toBeVisible();
        await expect(
            app.mainWindow.locator('app-html-video-player video[controls]')
        ).toHaveCount(0);
    } finally {
        await closeElectronApp(app);
    }
});
```

- [ ] **Step 4: Run atomized web and Electron settings E2E**

Run:

```bash
pnpm nx run web-e2e:e2e-ci--src/settings.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/settings.e2e.ts
```

Expected: both targets PASS. Browser settings survive reload, desktop settings
survive a full app restart, and the first HTML5 session after Save renders
`app-player-controls` without native video controls.

- [ ] **Step 5: Commit E2E coverage**

```bash
git add apps/web-e2e/src/settings.e2e.ts \
  apps/electron-backend-e2e/src/settings.e2e.ts
git commit -m "test(playback): cover shared controls setting"
```

## Task 5: Update Canonical Documentation and Run the Validation Ladder

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture/player-controls-contract.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the top-level Playback feature list**

Add this bullet under `README.md` → `Features` → `Playback`:

```md
- Optional unified IPTVnator controls for HTML5, Video.js, and ArtPlayer, enabled in **Settings → Playback** _(experimental)_
```

- [ ] **Step 2: Update the canonical controls contract**

In `docs/architecture/player-controls-contract.md`:

1. Replace “a default-off web rollout token” in the current-status list with:

```md
- a persisted, default-off web-player preference resolved through an immutable
  per-host rollout token;
```

2. Replace the compile-time-only current-status paragraph with:

```md
`Settings.webPlayerSharedControls` remains default-off. `WebPlayerViewComponent`
snapshots it into `WEB_PLAYER_SHARED_CONTROLS` when a new player host is
created, so HTML5, Video.js, and ArtPlayer switch atomically without an
application restart. Existing sessions never change controls mode in place.
```

3. Replace the rollout-symbol table rows with:

```md
| Symbol / setting                     |          Default | Current effect                                                          |
| ------------------------------------ | ---------------: | ----------------------------------------------------------------------- |
| `Settings.webPlayerSharedControls`   |          `false` | Persisted experimental opt-in shown for HTML5, Video.js, and ArtPlayer. |
| `WEB_PLAYER_SHARED_CONTROLS_ENABLED` |          `false` | Default-off fallback for direct component use and focused tests.        |
| `WEB_PLAYER_SHARED_CONTROLS`         | session snapshot | Component-scoped immutable value consumed by the three web engines.     |
```

4. State next to the Embedded MPV section:

```md
The web-player preference does not affect Embedded MPV. Frame-copy always uses
the shared DOM controls, while native-view keeps its compositor-safe legacy
dock.
```

- [ ] **Step 3: Keep agent documentation synchronized**

In both `AGENTS.md` and `CLAUDE.md`, update the shared-player-controls
description to include these exact facts:

```md
- The persisted `Settings.webPlayerSharedControls` preference is default-off
  and appears only when HTML5, Video.js, or ArtPlayer is selected.
- `WebPlayerViewComponent` snapshots the preference into the component-scoped
  `WEB_PLAYER_SHARED_CONTROLS` token for each new host; an existing session
  never changes controls mode in place.
- Embedded MPV ignores this preference: frame-copy always uses shared controls,
  native-view retains the legacy dock, and external MPV/VLC own their UI.
```

Preserve the existing engine lifecycle details around these sentences.

- [ ] **Step 4: Format and inspect documentation**

Run:

```bash
pnpm exec prettier --write README.md \
  docs/architecture/player-controls-contract.md AGENTS.md CLAUDE.md
git diff --check
```

Expected: Prettier completes successfully and `git diff --check` prints no
errors.

- [ ] **Step 5: Run the complete regression ladder**

Run:

```bash
pnpm nx build shared-interfaces --skip-nx-cache
pnpm nx test services --skip-nx-cache
pnpm nx test web --skip-nx-cache
pnpm nx test ui-playback --skip-nx-cache
pnpm nx run-many --target=lint \
  --projects=shared-interfaces,services,web,ui-playback,web-e2e,electron-backend-e2e \
  --skip-nx-cache
pnpm run typecheck:web
pnpm run i18n:check
pnpm nx build web --configuration=production --skip-nx-cache
pnpm nx run web-e2e:e2e-ci--src/settings.e2e.ts
pnpm nx run electron-backend-e2e:e2e-ci--src/settings.e2e.ts
git diff --check
```

Expected: every command exits `0`. Record command results in the final handoff;
if a platform-dependent Electron E2E cannot run, report the exact environment
constraint and the strongest completed substitute instead of claiming it
passed.

- [ ] **Step 6: Review the final diff against the approved design**

Confirm all of the following before committing:

- Default and malformed stored values resolve to `false`.
- Only HTML5, Video.js, and ArtPlayer expose the checkbox.
- Save affects the next player host without an app restart.
- One host receives one immutable boolean mode.
- Frame-copy Embedded MPV still always uses shared controls.
- Native-view Embedded MPV and external MPV/VLC remain unchanged.
- All 18 locales contain both keys.
- Unit, lint, typecheck, build, web E2E, and Electron E2E results are recorded.
- `README.md`, `docs/architecture/player-controls-contract.md`, `AGENTS.md`,
  and `CLAUDE.md` describe the shipped behavior consistently.

- [ ] **Step 7: Commit documentation and final integration**

```bash
git add README.md docs/architecture/player-controls-contract.md \
  AGENTS.md CLAUDE.md
git commit -m "docs(playback): document shared controls preference"
```
