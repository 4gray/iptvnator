/** Presentation policy only; it never splits a shared authentication session. */
export interface StalkerRequestOptions {
    /** Background failures still reject but never show a transport snackbar. */
    silent?: boolean;
}
