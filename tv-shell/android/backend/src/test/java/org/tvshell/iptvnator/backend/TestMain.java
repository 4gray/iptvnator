package org.tvshell.iptvnator.backend;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * Dependency-free test runner: every public {@code test*} method of the test
 * classes below is run; any exception is a failure. Used both locally
 * ({@code java ... TestMain}) and by the Gradle {@code backendTests} task.
 */
public final class TestMain {

    static final class AssertionFailed extends RuntimeException {
        private static final long serialVersionUID = 1L;

        AssertionFailed(String message) {
            super(message);
        }
    }

    static void assertEquals(String what, Object expected, Object actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionFailed(what + ": expected <" + expected + "> but was <" + actual + ">");
        }
    }

    static void assertTrue(String what, boolean condition) {
        if (!condition) throw new AssertionFailed(what);
    }

    public static void main(String[] args) throws Exception {
        Class<?>[] suites = {
            JsonTest.class, M3uParserTest.class, KodiPropTest.class, PortalUrlsTest.class,
            StalkerIdentityTest.class, WebBackendTest.class, PlaylistRecordTest.class, ShellSiteTest.class, HttpFetcherTest.class
        };
        int passed = 0;
        List<String> failures = new ArrayList<String>();
        for (Class<?> suite : suites) {
            Object instance = suite.getDeclaredConstructor().newInstance();
            for (Method method : suite.getMethods()) {
                if (!method.getName().startsWith("test") || method.getParameterTypes().length != 0) continue;
                String name = suite.getSimpleName() + "." + method.getName();
                try {
                    method.invoke(instance);
                    passed++;
                    System.out.println("  ok   " + name);
                } catch (java.lang.reflect.InvocationTargetException e) {
                    Throwable cause = e.getCause();
                    failures.add(name + ": " + cause);
                    System.out.println("  FAIL " + name + ": " + cause);
                    if (!(cause instanceof AssertionFailed)) cause.printStackTrace(System.out);
                }
            }
        }
        System.out.println(passed + " passed, " + failures.size() + " failed");
        if (!failures.isEmpty()) {
            for (String failure : failures) System.out.println("  - " + failure);
            System.exit(1);
        }
    }
}
