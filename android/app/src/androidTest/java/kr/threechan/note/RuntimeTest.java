package kr.threechan.note;

import static org.junit.Assert.*;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.net.URL;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.junit.Test;
import org.junit.Assume;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RuntimeTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

    @Test public void bundledEditorIsAvailableWithoutTheServer() throws Exception {
        try (InputStream source = context().getAssets().open("public/index.html")) {
            String html = new String(source.readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(html.contains("노트"));
            assertTrue(html.contains("/_next/static/"));
            assertFalse(html.contains("APP_ACCESS_KEY"));
        }
        assertTrue(context().getAssets().list("public/_next/static").length > 0);
    }

    @Test public void androidTrustsTheProductionTlsCertificateAndRequiresAuthentication() throws Exception {
        HttpsURLConnection health = (HttpsURLConnection) new URL("https://note.3chan.kr/").openConnection();
        health.setConnectTimeout(15000); health.setReadTimeout(15000);
        try {
            assertEquals(200, health.getResponseCode());
            assertTrue(health.getCipherSuite().startsWith("TLS_"));
            assertTrue(new String(health.getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("Tailscale"));
        } finally { health.disconnect(); }
        HttpsURLConnection status = (HttpsURLConnection) new URL("https://note.3chan.kr/api/status").openConnection();
        status.setConnectTimeout(15000); status.setReadTimeout(15000);
        try { assertEquals(404, status.getResponseCode()); }
        finally { status.disconnect(); }
    }
    @Test public void tailscaleIdentityNeedsNoApplicationToken() throws Exception {
        try { InetAddress.getByName("audax-vm.tail62313c.ts.net"); }
        catch (UnknownHostException missingTailnet) {
            Assume.assumeNoException("Connect this Android test device to Tailscale before testing private identity.", missingTailnet);
        }
        HttpsURLConnection identity = (HttpsURLConnection) new URL("https://audax-vm.tail62313c.ts.net:8443/api/auth/identity").openConnection();
        identity.setConnectTimeout(15000); identity.setReadTimeout(15000);
        try {
            assertEquals(200, identity.getResponseCode());
            String body = new String(identity.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(body.contains("\"auth\":\"tailscale\""));
            assertFalse(body.contains("\"token\""));
            assertNull(identity.getHeaderField("Set-Cookie"));
        } finally { identity.disconnect(); }
    }
}
