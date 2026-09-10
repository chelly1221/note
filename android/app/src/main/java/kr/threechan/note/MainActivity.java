package kr.threechan.note;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import java.security.KeyStore;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        // Version 0.1.1 uses Tailscale identity and never keeps an app session key.
        getSharedPreferences("note_credentials", MODE_PRIVATE).edit().clear().apply();
        deleteSharedPreferences("note_credentials");
        try {
            KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
            keys.load(null);
            if (keys.containsAlias("note.session.key.v1")) keys.deleteEntry("note.session.key.v1");
        } catch (Exception ignored) { /* Legacy tokens are disabled on the server. */ }
        super.onCreate(savedInstanceState);
    }
}
