package kr.threechan.note;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RuntimeTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

    @Test public void secureTokenSurvivesReopenWithoutPlaintextOnDisk() throws Exception {
        String suffix = UUID.randomUUID().toString();
        String name = "qa_credentials_" + suffix;
        String alias = "qa.note." + suffix;
        SharedPreferences prefs = context().getSharedPreferences(name, Context.MODE_PRIVATE);
        try {
            CredentialStore store = new CredentialStore(context(), name, alias);
            String value = "qa-session-한국어-" + UUID.randomUUID();
            store.set(value);
            String encrypted = prefs.getString("session", "");
            assertFalse(encrypted.contains(value));
            assertTrue(encrypted.contains(":"));
            assertEquals(value, new CredentialStore(context(), name, alias).get());
            store.set(value);
            assertNotEquals("Each encryption must use a fresh IV", encrypted, prefs.getString("session", ""));
            assertTrue(prefs.edit().putString("session", "tampered:payload").commit());
            assertNull(store.get());
            assertFalse(prefs.contains("session"));
            store.set(value);
            store.remove();
            assertNull(store.get());
        } finally {
            prefs.edit().clear().commit();
            context().deleteSharedPreferences(name);
            KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
            if (keys.containsAlias(alias)) keys.deleteEntry(alias);
        }
    }

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
        HttpsURLConnection health = (HttpsURLConnection) new URL("https://note.3chan.kr/api/health").openConnection();
        health.setConnectTimeout(15000); health.setReadTimeout(15000);
        try {
            assertEquals(200, health.getResponseCode());
            assertTrue(health.getCipherSuite().startsWith("TLS_"));
            assertTrue(new String(health.getInputStream().readAllBytes(), StandardCharsets.UTF_8).contains("\"storageReady\":true"));
        } finally { health.disconnect(); }
        HttpsURLConnection status = (HttpsURLConnection) new URL("https://note.3chan.kr/api/status").openConnection();
        status.setConnectTimeout(15000); status.setReadTimeout(15000);
        try { assertEquals(401, status.getResponseCode()); }
        finally { status.disconnect(); }
    }
}
