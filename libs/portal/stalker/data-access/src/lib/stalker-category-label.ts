/**
 * What a Stalker genre is called: the portal's own name, or — for an entry
 * the store adds itself, such as the every-item genre `'*'` — a translation
 * key. The key stays untranslated in state so that a runtime language switch
 * re-labels the entry instead of keeping the language it was loaded in.
 */
export interface StalkerCategoryLabel {
    readonly name: string;
    readonly labelKey: string | null;
}

/**
 * The label's text in the current language. A caller that keeps the result
 * in a `computed` must also read a language signal (see `onLangChange`), or
 * the text stays in the language the computed first ran in.
 */
export function stalkerCategoryLabelText(
    label: StalkerCategoryLabel,
    translate: (key: string) => string
): string {
    return label.labelKey ? translate(label.labelKey) : label.name;
}
