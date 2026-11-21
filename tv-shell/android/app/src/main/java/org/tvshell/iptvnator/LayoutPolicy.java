package org.tvshell.iptvnator;

/** Effective layout rules, independent of Android for regression testing. */
public final class LayoutPolicy {
    private LayoutPolicy() {}

    public static boolean isTvDevice(boolean televisionMode, boolean leanback, boolean touchscreen) {
        return televisionMode || (leanback && !touchscreen);
    }

    public static boolean useTvLayout(String mode, boolean tvDevice, int windowWidthDp) {
        if (!tvDevice && windowWidthDp > 0 && windowWidthDp <= 640) return false;
        if ("TOUCH".equals(mode)) return false;
        if ("TV".equals(mode)) return true;
        return tvDevice;
    }
}
