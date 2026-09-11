package kr.threechan.note;
import static org.junit.Assert.*;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.*;
import java.io.FileInputStream;
import org.junit.*;
import org.junit.runner.RunWith;

/** Disposable debug emulator only. Uses the real packaged WebView bundle without an Activity. */
@RunWith(AndroidJUnit4.class)
public class BackgroundSyncTest {
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private String shell(String command)throws Exception{try(ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);FileInputStream in=new FileInputStream(fd.getFileDescriptor())){return new String(in.readAllBytes());}}
 @After public void cleanup()throws Exception{BackgroundSyncWorker.configure(context,false);shell("cmd deviceidle whitelist -"+context.getPackageName());}
 @Test public void detectsActualBatteryPermissionAndStopsAskingWhenGranted()throws Exception{
  shell("cmd deviceidle whitelist -"+context.getPackageName());SystemClock.sleep(200);
  assertFalse(BackgroundSyncPlugin.snapshot(context).optBoolean("batteryAllowed"));
  assertEquals("battery",BackgroundSyncPlugin.needed(BackgroundSyncPlugin.snapshot(context)));
  shell("cmd deviceidle whitelist +"+context.getPackageName());SystemClock.sleep(200);
  assertTrue(BackgroundSyncPlugin.snapshot(context).optBoolean("batteryAllowed"));
  assertEquals("",BackgroundSyncPlugin.needed(BackgroundSyncPlugin.snapshot(context)));
 }
 @Test public void bundledWorkerRunsWithoutActivityAndSkipsSignedOutAccount()throws Exception{
  BackgroundSyncWorker.foreground(false);
  BackgroundSyncWorker.prefs(context).edit().clear().putBoolean("enabled",true).commit();
  OneTimeWorkRequest request=new OneTimeWorkRequest.Builder(BackgroundSyncWorker.class).build();
  WorkManager manager=WorkManager.getInstance(context);manager.enqueue(request).getResult().get();
  long deadline=System.currentTimeMillis()+45000;WorkInfo info=null;
  while(System.currentTimeMillis()<deadline){info=manager.getWorkInfoById(request.getId()).get();if(info!=null&&info.getState().isFinished())break;SystemClock.sleep(200);}
  assertNotNull(info);assertEquals(WorkInfo.State.SUCCEEDED,info.getState());
  assertTrue(BackgroundSyncWorker.prefs(context).getLong("lastAttempt",0)>0);
  assertEquals("skipped",BackgroundSyncWorker.prefs(context).getString("outcome",""));
  assertEquals(0,BackgroundSyncWorker.prefs(context).getLong("lastSuccess",0));
 }
 @Test public void schedulingIsUniqueAndLogoutCancelsBothJobs()throws Exception{
  BackgroundSyncWorker.foreground(true);
  BackgroundSyncWorker.configure(context,true);BackgroundSyncWorker.configure(context,true);
  BackgroundSyncWorker.soon(context);BackgroundSyncWorker.soon(context);
  WorkManager manager=WorkManager.getInstance(context);SystemClock.sleep(400);
  assertEquals(1,manager.getWorkInfosForUniqueWork(BackgroundSyncWorker.PERIODIC).get().stream().filter(w->!w.getState().isFinished()).count());
  assertEquals(1,manager.getWorkInfosForUniqueWork(BackgroundSyncWorker.SOON).get().stream().filter(w->!w.getState().isFinished()).count());
  BackgroundSyncWorker.configure(context,false);SystemClock.sleep(400);
  assertEquals(0,manager.getWorkInfosForUniqueWork(BackgroundSyncWorker.PERIODIC).get().stream().filter(w->!w.getState().isFinished()).count());
  assertEquals(0,manager.getWorkInfosForUniqueWork(BackgroundSyncWorker.SOON).get().stream().filter(w->!w.getState().isFinished()).count());
 }
}
