package kr.threechan.note;

import static org.junit.Assert.*;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import android.app.ActivityManager;
import android.content.Context;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AuthBrowserTest {
    @Test public void onlyTailscaleAuthenticationEndpointsAreAllowed() {
        assertTrue(AuthBrowserPlugin.isAllowedUrl("https://login.tailscale.com/a/test"));
        assertTrue(AuthBrowserPlugin.isAllowedUrl("https://console.tailscale.com/admin/machines"));
        for (String url : new String[]{"http://login.tailscale.com/a/test", "https://login.tailscale.com.attacker.test/a/test", "https://u:p@login.tailscale.com/a/test", "https://login.tailscale.com:444/a/test", "https://example.com/"})
            assertFalse(AuthBrowserPlugin.isAllowedUrl(url));
    }

    @Test public void customTabClosesBackToTheExistingAppActivity() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> host = new AtomicReference<>();
            // Exercise the browser lifecycle on a public, non-authentication page.
            // Production callers reach this through the URL-restricted plugin.
            scenario.onActivity(activity -> { host.set(activity); activity.openAuthTab("https://example.com/"); });
            long deadline = System.currentTimeMillis() + 10000;
            while (scenario.getState() == Lifecycle.State.RESUMED && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertNotEquals("Custom Tab should cover the app", Lifecycle.State.RESUMED, scenario.getState());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> host.get().closeAuthTab());
            deadline = System.currentTimeMillis() + 10000;
            while (scenario.getState() != Lifecycle.State.RESUMED && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertEquals("Closing should return to the existing app", Lifecycle.State.RESUMED, scenario.getState());
            scenario.onActivity(activity -> assertSame(host.get(), activity));
            scenario.onActivity(activity -> {
                ActivityManager manager = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
                for (ActivityManager.AppTask task : manager.getAppTasks()) {
                    ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                    if (info.id == activity.getTaskId()) assertEquals("Authentication tab must be removed from the back stack", 1, info.numActivities);
                }
            });
        }
    }
}
