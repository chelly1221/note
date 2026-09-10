package kr.threechan.note;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import java.security.KeyStore;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

public class MainActivity extends BridgeActivity {
    private boolean authTabOpen;
    private boolean authHostStopped;
    private boolean authCloseRequested;

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuthBrowserPlugin.class);
        authTabOpen = savedInstanceState != null && savedInstanceState.getBoolean("note.authTabOpen", false);
        authHostStopped = authTabOpen;
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

    void openAuthTab(String url) {
        if (authTabOpen) return;
        authHostStopped = false;
        authCloseRequested = false;
        String browserPackage = CustomTabsClient.getPackageName(this, null);
        if (browserPackage == null) throw new IllegalStateException("Custom Tabs unavailable");
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                        .setToolbarColor(Color.rgb(17, 17, 17))
                        .setNavigationBarColor(Color.rgb(17, 17, 17)).build())
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                .build();
        tab.intent.setPackage(browserPackage);
        tab.intent.setData(Uri.parse(url));
        // Keep the Custom Tab in this app's task, above the existing editor.
        startActivity(tab.intent);
        authTabOpen = true;
    }

    void closeAuthTab() {
        if (!authTabOpen) return;
        authCloseRequested = true;
        // Approval can arrive during the opening animation. Wait until the tab
        // actually covers the host, otherwise it can appear after our return.
        if (!authHostStopped) return;
        Intent returnToNotes = new Intent(this, MainActivity.class);
        returnToNotes.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(returnToNotes);
        authTabOpen = false;
        authCloseRequested = false;
    }

    @Override public void onResume() {
        super.onResume();
        // A manual close also returns here; a later approval must not reopen the app.
        if (authHostStopped) {
            authTabOpen = false;
            authCloseRequested = false;
            authHostStopped = false;
        }
    }

    @Override public void onStop() {
        super.onStop();
        if (authTabOpen) {
            authHostStopped = true;
            if (authCloseRequested) closeAuthTab();
        }
    }

    @Override public void onSaveInstanceState(Bundle outState) {
        outState.putBoolean("note.authTabOpen", authTabOpen);
        super.onSaveInstanceState(outState);
    }
}
