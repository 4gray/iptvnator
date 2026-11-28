package org.tvshell.iptvnator.ui;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import fi.iki.elonen.NanoHTTPD;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import junit.framework.TestCase;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;
import org.tvshell.iptvnator.Prefs;
import org.tvshell.iptvnator.server.TvShellServer;

public class StandalonePlaylistCancellationTest extends TestCase {
    public void testCancellingAPlaylistReleasesTheBlockedProviderRequest() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        NanoHTTPD provider = new NanoHTTPD("127.0.0.1", 0) {
            @Override public NanoHTTPD.Response serve(IHTTPSession session) {
                started.countDown();
                try { release.await(12, TimeUnit.SECONDS); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                return newFixedLengthResponse("#EXTM3U\n#EXTINF:-1,Synthetic channel\nhttps://media.test/clip");
            }
        };
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        TvShellServer shell = new TvShellServer(context, new Prefs(context), 0);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        OkHttpClient client = new OkHttpClient.Builder().callTimeout(7, TimeUnit.SECONDS).build();
        try {
            provider.start();
            shell.start();
            String base = "http://127.0.0.1:" + shell.getListeningPort() + "/api/";
            String id = "00000000-0000-4000-8000-000000000001";
            String target;
            RequestBody registration = RequestBody.create(new JSONObject()
                .put("url", "http://127.0.0.1:" + provider.getListeningPort() + "/playlist.m3u")
                .toString(), MediaType.get("application/json"));
            try (Response response = client.newCall(new Request.Builder().url(base + "provider-targets").post(registration).build()).execute()) {
                assertEquals(200, response.code());
                target = new JSONObject(response.body().string()).getString("targetId");
            }
            Future<Integer> downloading = worker.submit(() -> {
                Request request = new Request.Builder().url(base + "parse?targetId=" + target + "&requestId=" + id).build();
                try (Response response = client.newCall(request).execute()) { return response.code(); }
            });
            assertTrue("Provider request started", started.await(4, TimeUnit.SECONDS));
            Request cancel = new Request.Builder().url(base + "parse/cancel?requestId=" + id)
                .post(RequestBody.create(new byte[0], null)).build();
            try (Response response = client.newCall(cancel).execute()) {
                assertEquals(204, response.code());
            }
            assertEquals(409, downloading.get(4, TimeUnit.SECONDS).intValue());
        } finally {
            release.countDown();
            worker.shutdownNow();
            shell.stop();
            provider.stop();
        }
    }
}
