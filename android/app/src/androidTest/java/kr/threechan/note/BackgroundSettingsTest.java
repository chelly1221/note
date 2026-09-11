package kr.threechan.note;
import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.*;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run after OfflineStartupTest on a disposable emulator. Preserves that local-only fixture. */
@RunWith(AndroidJUnit4.class)
public class BackgroundSettingsTest {
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private String js(ActivityScenario<MainActivity> app,String script)throws Exception{
  AtomicReference<String> value=new AtomicReference<>("");CountDownLatch done=new CountDownLatch(1);
  app.onActivity(a->a.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));
  assertTrue(done.await(5,TimeUnit.SECONDS));return value.get();
 }
 private void waitFor(ActivityScenario<MainActivity> app,String expression)throws Exception{
  for(int i=0;i<100;i++){if("true".equals(js(app,expression)))return;SystemClock.sleep(100);}capture(app,"background-failure");fail(expression+" | "+js(app,"JSON.stringify({body:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>[b.textContent,b.getAttribute('aria-label')])})"));
 }
 private void shell(String command)throws Exception{try(ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);FileInputStream in=new FileInputStream(fd.getFileDescriptor())){in.readAllBytes();}}
 private void capture(ActivityScenario<MainActivity> app,String name)throws Exception{
  CountDownLatch frame=new CountDownLatch(1);app.onActivity(a->{a.getBridge().getWebView().postVisualStateCallback(1,new android.webkit.WebView.VisualStateCallback(){@Override public void onComplete(long id){frame.countDown();}});a.getBridge().getWebView().invalidate();});assertTrue(frame.await(5,TimeUnit.SECONDS));InstrumentationRegistry.getInstrumentation().waitForIdleSync();
  Bitmap bitmap=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();assertNotNull(bitmap);
  try(FileOutputStream out=new FileOutputStream(new File(context.getExternalFilesDir(null),name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();
 }
 @Test public void onlyUnmetSettingsHaveActionsAndReturnRefreshesThem()throws Exception{
  BackgroundSyncWorker.prefs(context).edit().putLong("remindAfter",System.currentTimeMillis()+86400000L).commit();
  shell("cmd deviceidle whitelist -"+context.getPackageName());
  try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
   waitFor(app,"document.body.innerText.length>50&&!document.querySelector('.access-page,main.gate')");
   js(app,"document.querySelector('button.list-foot')?.click()");
   waitFor(app,"Boolean(document.querySelector('.background-sync-settings'))");
   js(app,"document.querySelector('.background-sync-settings').scrollIntoView({block:'start'})");
   waitFor(app,"document.querySelector('.background-sync-settings').innerText.includes('배터리 사용 제한 해제하기')");
   assertEquals("true",js(app,"document.documentElement.scrollWidth<=innerWidth"));
   SystemClock.sleep(350);capture(app,"background-required");
   shell("cmd deviceidle whitelist +"+context.getPackageName());
   app.moveToState(Lifecycle.State.CREATED);app.moveToState(Lifecycle.State.RESUMED);
   waitFor(app,"!document.querySelector('.background-sync-settings').innerText.includes('배터리 사용 제한 해제하기')");
   js(app,"window.Capacitor.nativePromise('BackgroundSync','openSettings',{kind:'battery'}).then(()=>window.__alreadyAllowed=true)");
   waitFor(app,"window.__alreadyAllowed===true");
   assertEquals(Lifecycle.State.RESUMED,app.getState());
   SystemClock.sleep(350);capture(app,"background-allowed");
  }finally{shell("cmd deviceidle whitelist -"+context.getPackageName());BackgroundSyncWorker.configure(context,false);}
 }
}
