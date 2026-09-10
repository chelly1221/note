package kr.threechan.note;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM data on disk; its encryption key stays inside Android Keystore. */
final class CredentialStore {
    private final SharedPreferences preferences;
    private final String alias;

    CredentialStore(Context context) {
        this(context, "note_credentials", "note.session.key.v1");
    }

    CredentialStore(Context context, String name, String alias) {
        preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE);
        this.alias = alias;
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    synchronized String get() throws Exception {
        String stored = preferences.getString("session", null);
        if (stored == null) return null;
        try {
            String[] parts = stored.split(":", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception invalid) {
            // An invalidated key requires signing this device in again.
            remove();
            return null;
        }
    }

    synchronized void set(String value) throws Exception {
        if (value == null || value.isEmpty() || value.length() > 4096) throw new IllegalArgumentException("Invalid session token.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString("session", stored).commit()) throw new Exception("Storage failed");
    }

    synchronized void remove() throws Exception {
        if (!preferences.edit().remove("session").commit()) throw new Exception("Storage failed");
    }
}
