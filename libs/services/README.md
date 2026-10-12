# services

Shared runtime data access: injectable services, stores and runtime bridges
used across the renderer. It also hosts `injectTranslationTick()`, the signal
every `computed` that calls `TranslateService.instant` reads (see "Translated
Text" in the [UI guidelines](../../docs/architecture/iptvnator-ui-guidelines.md)).

This library was generated with [Nx](https://nx.dev).

## Running unit tests

Run `nx test services` to execute the unit tests.
