package kr.threechan.note;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.work.Operation;
import java.util.concurrent.TimeUnit;

/** Resume admitted accounts after boot/update without opening an Activity. */
public class BackgroundSyncReceiver extends BroadcastReceiver {
    static Operation restore(Context context, String action) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return null;
        // The stored opt-in survives process death. Never re-enable a signed-out account.
        return BackgroundSyncWorker.soon(context);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !BackgroundSyncWorker.enabled(context)) return;
        Context app = context.getApplicationContext();
        String action = intent.getAction();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Operation operation = restore(app, action);
                // Keep the receiver alive until WorkManager persists the request.
                if (operation != null) operation.getResult().get(8, TimeUnit.SECONDS);
            } catch (Exception error) {
                Log.w("noteBackground", "Recovery scheduling deferred to periodic work", error);
            } finally {
                pending.finish();
            }
        }, "note-sync-recovery").start();
    }
}
