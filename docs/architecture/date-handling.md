# Date Handling

## Rules

- Use native `Date`, ISO strings, and epoch timestamps as the stored/runtime values.
- Use `date-fns` for parsing, arithmetic, and normalization logic.
- Use Angular `DatePipe` in templates when the value is already a `Date`, ISO string, or epoch timestamp.
- Use cached `Intl.DateTimeFormat` helpers in TypeScript-only formatting paths where Angular pipes are not available.
- Do not add new `moment` usage. The app no longer depends on it.

## Locale Strategy

- Date display should follow the user-selected app language from `TranslateService`.
- When a template renders localized month or weekday names, pass the normalized app locale explicitly to `DatePipe`.
- Angular locale data is registered in [apps/web/src/app/app-date-locales.ts](/Users/4gray/Code/iptvnator/apps/web/src/app/app-date-locales.ts).
- App language aliases are normalized in [libs/ui/pipes/src/lib/date-format.util.ts](/Users/4gray/Code/iptvnator/libs/ui/pipes/src/lib/date-format.util.ts):
  - `ary` -> `ar-MA`
  - `by` -> `be`
  - `zhtw` -> `zh-Hant`

## Parsing Boundaries

- Normalize provider-specific or legacy date strings to ISO as early as possible.
- Keep optional epoch fields such as `startTimestamp` and `stopTimestamp` when the provider already supplies them.
- Avoid new non-standard `Date.parse(...)` usage for provider formats; prefer explicit `date-fns` parsing when the input is not ISO.
