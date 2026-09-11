package kr.threechan.note;

import android.content.*;
import android.os.*;
import android.webkit.*;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewAssetLoader;
import androidx.work.*;
import org.json.*;
import java.io.ByteArrayInputStream;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Notification-free, bounded work. Android owns scheduling across process death and reboot. */
public class BackgroundSyncWorker extends Worker {
    static final String PREFS="background-sync-v1", PERIODIC="automatic-sync-v1", SOON="automatic-sync-soon-v1";
    private static volatile boolean foreground;
    private static volatile BackgroundSyncWorker active;
    private final CountDownLatch finished=new CountDownLatch(1);
    private final Handler main=new Handler(Looper.getMainLooper());
    private final AtomicBoolean completed=new AtomicBoolean();
    private volatile String outcome="retry";
    private WebView view;
    public BackgroundSyncWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    static boolean enabled(Context c){return prefs(c).getBoolean("enabled",false);}
    static boolean isForeground(){return foreground;}
    static void foreground(boolean value){
        foreground=value;
        if(value&&active!=null)active.finish("foreground");
    }
    static void configure(Context c,boolean enabled){
        prefs(c).edit().putBoolean("enabled",enabled).apply();
        WorkManager work=WorkManager.getInstance(c);

        if(!enabled){
            work.cancelUniqueWork(PERIODIC);work.cancelUniqueWork(SOON);
            if(active!=null)active.main.post(()->{if(active!=null)active.finish("skipped");});
        }else ensureScheduled(c);
    }
    static Constraints constraints(){return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();}
    static void ensureScheduled(Context c){
        if(!enabled(c))return;
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PERIODIC,ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(BackgroundSyncWorker.class,15,TimeUnit.MINUTES)
                .setConstraints(constraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,1,TimeUnit.MINUTES).build());
    }
    static void soon(Context c){
        if(!enabled(c))return;
        ensureScheduled(c);
        WorkManager.getInstance(c).enqueueUniqueWork(SOON,ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(BackgroundSyncWorker.class).setInitialDelay(20,TimeUnit.SECONDS)
                .setConstraints(constraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,1,TimeUnit.MINUTES).build());
    }
    @NonNull @Override public Result doWork(){
        if(!enabled(getApplicationContext())||foreground)return Result.success();
        main.post(()->{
            if(isStopped()||foreground||!enabled(getApplicationContext())){finish("skipped");return;}
            if(active!=null){finish("busy");return;}
            active=this;
            prefs(getApplicationContext()).edit().putLong("lastAttempt",System.currentTimeMillis()).putString("outcome","running").apply();
            start();
        });
        try{
            if(!finished.await(180,TimeUnit.SECONDS))main.post(()->finish("retry"));
        }catch(InterruptedException e){Thread.currentThread().interrupt();main.post(()->finish("retry"));}
        return outcome.equals("retry")||outcome.equals("busy")?Result.retry():Result.success();
    }
    @Override public void onStopped(){main.post(()->finish("retry"));}
    private void finish(String result){
        if(!completed.compareAndSet(false,true))return;
        outcome=result;
        if(active==this){
            SharedPreferences.Editor edit=prefs(getApplicationContext()).edit().putString("outcome",result);
            if(result.equals("ok"))edit.putLong("lastSuccess",System.currentTimeMillis());
            edit.apply();active=null;
        }
        if(view!=null){view.stopLoading();view.removeJavascriptInterface("BackgroundSyncNative"); view.destroy();view=null;}
        finished.countDown();
    }
    private WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not found",java.util.Map.of(),new ByteArrayInputStream(new byte[0]));}
    @SuppressWarnings("SetJavaScriptEnabled") private void start(){
        try{
            WebViewAssetLoader loader=new WebViewAssetLoader.Builder().setDomain("localhost").addPathHandler("/",path->{
                if(path.contains("..")||path.contains("\\"))return missing();
                try{
                    String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".wasm")?"application/wasm":path.endsWith(".html")?"text/html":"application/octet-stream";
                    return new WebResourceResponse(mime,"UTF-8",getApplicationContext().getAssets().open("public/"+path));
                }catch(Exception e){return missing();}
            }).build();
            view=new WebView(getApplicationContext());
            view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);
            view.getSettings().setAllowFileAccess(false);view.getSettings().setAllowContentAccess(false);
            view.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            view.setWebViewClient(new WebViewClient(){
                @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}
                @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}
                @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())finish("retry");}
                @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse e){if(r.isForMainFrame())finish("retry");}
                @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){finish("retry");return true;}
            });
            NativeBridge bridge=new NativeBridge();
            view.addJavascriptInterface(bridge,"BackgroundSyncNative");
            view.loadUrl("https://localhost/background.html");
        }catch(Exception e){finish("retry");}
    }
    final class NativeBridge {
        @JavascriptInterface public String invoke(String method,String input){
            try{
                if(completed.get()||isStopped()||!enabled(getApplicationContext()))throw new IllegalStateException();
                JSONObject args=new JSONObject(input),result;
                switch(method){
                    case "finish":
                        String value=args.optString("outcome","retry");
                        if(!java.util.Set.of("ok","auth","skipped","retry").contains(value))value="retry";
                        final String end=value;main.post(()->finish(end));result=new JSONObject();break;

                    default:throw new SecurityException("Unsupported background operation");
                }
                return new JSONObject().put("result",result).toString();
            }catch(Exception e){return "{\"error\":\"백그라운드 동기화를 완료하지 못했어요.\"}";}
        }
    }
}
