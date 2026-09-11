package kr.threechan.note;

import android.app.*;
import android.content.*;
import android.net.*;
import android.os.*;
import android.provider.Settings;
import androidx.core.content.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.*;
import java.util.function.Consumer;

@CapacitorPlugin(name="BackgroundSync")
public class BackgroundSyncPlugin extends Plugin {
    private final Set<String> prompted=new HashSet<>();
    static JSObject snapshot(Context c){
        SharedPreferences p=BackgroundSyncWorker.prefs(c);
        PowerManager power=(PowerManager)c.getSystemService(Context.POWER_SERVICE);
        ActivityManager activity=(ActivityManager)c.getSystemService(Context.ACTIVITY_SERVICE);
        ConnectivityManager connectivity=(ConnectivityManager)c.getSystemService(Context.CONNECTIVITY_SERVICE);
        return new JSObject().put("enabled",BackgroundSyncWorker.enabled(c))
            .put("batteryAllowed",power.isIgnoringBatteryOptimizations(c.getPackageName()))
            .put("backgroundRestricted",Build.VERSION.SDK_INT>=28&&activity.isBackgroundRestricted())
            .put("dataRestricted",connectivity.getRestrictBackgroundStatus()==ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED)
            .put("lastAttempt",p.getLong("lastAttempt",0)).put("lastSuccess",p.getLong("lastSuccess",0))
            .put("outcome",p.getString("outcome","waiting"));
    }
    private void read(Consumer<JSObject> result){
        var future=PackageManagerCompat.getUnusedAppRestrictionsStatus(getContext());
        future.addListener(()->{
            int unused=UnusedAppRestrictionsConstants.ERROR;
            try{unused=future.get();}catch(Exception ignored){}
            JSObject state=snapshot(getContext()).put("unusedStatus",unused)
                .put("unusedRestricted",unused==UnusedAppRestrictionsConstants.API_30_BACKPORT||unused==UnusedAppRestrictionsConstants.API_30||unused==UnusedAppRestrictionsConstants.API_31);
            result.accept(state);
        },ContextCompat.getMainExecutor(getContext()));
    }
    @PluginMethod public void status(PluginCall call){read(call::resolve);}
    @PluginMethod public void configure(PluginCall call){
        BackgroundSyncWorker.configure(getContext(),Boolean.TRUE.equals(call.getBoolean("enabled",false)));
        read(call::resolve);
    }
    static String needed(JSObject state){
        if(state.optBoolean("backgroundRestricted"))return "app";
        if(!state.optBoolean("batteryAllowed"))return "battery";
        if(state.optBoolean("dataRestricted"))return "data";
        if(state.optBoolean("unusedRestricted"))return "unused";
        return "";
    }
    private void open(String kind,JSObject state){
        // Recheck immediately before navigating; an already resolved setting does nothing.
        if(kind.equals("battery")&&state.optBoolean("batteryAllowed")||kind.equals("data")&&!state.optBoolean("dataRestricted")||kind.equals("app")&&!state.optBoolean("backgroundRestricted")||kind.equals("unused")&&!state.optBoolean("unusedRestricted"))return;
        if(kind.equals("unused")){
            getActivity().startActivityForResult(IntentCompat.createManageUnusedAppRestrictionsIntent(getContext(),getContext().getPackageName()),7391);
            return;
        }
        String action=kind.equals("battery")?Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS:
            kind.equals("data")?Settings.ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS:Settings.ACTION_APPLICATION_DETAILS_SETTINGS;
        Intent intent=new Intent(action,Uri.parse("package:"+getContext().getPackageName()));
        try{getActivity().startActivity(intent);}catch(ActivityNotFoundException e){getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getContext().getPackageName())));}
    }
    @PluginMethod public void openSettings(PluginCall call){
        String kind=call.getString("kind","");
        if(!Set.of("battery","data","app","unused").contains(kind)){call.reject("지원하지 않는 설정이에요.");return;}
        read(state->{try{open(kind,state);call.resolve();}catch(Exception e){call.reject("시스템 설정을 열지 못했어요.");}});
    }
    private void prompt(JSObject state){
        String kind=needed(state);long now=System.currentTimeMillis();
        if(!BackgroundSyncWorker.isForeground()||getActivity().isFinishing()||!state.optBoolean("enabled")||kind.isEmpty()||prompted.contains(kind)||BackgroundSyncWorker.prefs(getContext()).getLong("remindAfter",0)>now)return;
        prompted.add(kind);
        String reason=kind.equals("battery")?"배터리 최적화가 적용되어 있어 앱을 오래 열지 않으면 동기화가 늦어질 수 있어요. 다음 화면에서 배터리 사용 제한을 해제해 주세요.":
            kind.equals("data")?"데이터 절약 모드가 백그라운드 통신을 제한하고 있어요. 다음 화면에서 제한 없는 데이터 사용을 허용해 주세요.":
            kind.equals("unused")?"오래 사용하지 않으면 앱 활동이나 권한을 자동으로 중지하는 설정이 켜져 있어요. 다음 화면에서 ‘사용하지 않는 앱 활동 일시중지’ 또는 ‘권한 자동 삭제’를 꺼 주세요.":
            "Android가 이 앱의 백그라운드 실행을 제한하고 있어요. 앱 정보의 배터리 설정에서 ‘제한 없음’을 선택해 주세요. 기기마다 메뉴 이름이 다를 수 있어요.";
        new AlertDialog.Builder(getActivity()).setTitle("앱을 닫아도 동기화하려면")
            .setMessage("알림 없는 자동 동기화는 켜져 있어요.\n\n"+reason+"\n\n이미 허용한 설정은 다시 요청하지 않아요.")
            .setPositiveButton("설정하기",(dialog,which)->read(fresh->{try{open(kind,fresh);}catch(Exception ignored){}}))
            .setNegativeButton("나중에",(dialog,which)->postpone(now))
            .setOnCancelListener(dialog->postpone(now)).show();
    }
    private void postpone(long now){BackgroundSyncWorker.prefs(getContext()).edit().putLong("remindAfter",now+86400000L).apply();}
    @PluginMethod public void requestSetup(PluginCall call){read(state->{prompt(state);call.resolve(state);});}
    @Override protected void handleOnResume(){read(state->{notifyListeners("statusChanged",state);prompt(state);});}
}
