package org.tvshell.iptvnator;

public class LayoutPolicyTest {
    private static void check(boolean actual, boolean expected) {
        if (actual != expected) throw new AssertionError("Unexpected layout policy result");
    }

    public static void main(String[] args) {
        check(LayoutPolicy.isTvDevice(true, false, true), true);
        check(LayoutPolicy.isTvDevice(false, true, false), true);
        check(LayoutPolicy.isTvDevice(false, true, true), false);
        check(LayoutPolicy.useTvLayout("TV", false, 640), false);
        check(LayoutPolicy.useTvLayout("TV", false, 641), true);
        check(LayoutPolicy.useTvLayout("TV", true, 320), true);
        check(LayoutPolicy.useTvLayout("AUTO", true, 320), true);
        check(LayoutPolicy.useTvLayout("TOUCH", true, 320), false);
        check(LayoutPolicy.useTvLayout("AUTO", false, 400), false);
        System.out.println("Layout policy checks passed");
    }
}
