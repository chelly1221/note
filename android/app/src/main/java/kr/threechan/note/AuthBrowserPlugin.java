package kr.threechan.note;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AuthBrowser")
public class AuthBrowserPlugin extends Plugin {
    static boolean isAllowedUrl(String value) {
        if (value == null) return false;
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null ||
                (uri.getPort() != -1 && uri.getPort() != 443)) return false;
        return ("login.tailscale.com".equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/a/")) ||
                ("console.tailscale.com".equals(uri.getHost()) && "/admin/machines".equals(uri.getPath()));
    }

    @PluginMethod public void open(PluginCall call) {
        String url = call.getString("url");
        if (!isAllowedUrl(url)) { call.reject("허용되지 않은 인증 주소예요."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                ((MainActivity) getActivity()).openAuthTab(url);
                call.resolve();
            } catch (Exception error) {
                call.reject("인앱 인증 창을 열지 못했어요. Chrome 등 지원 브라우저가 설치되어 있는지 확인해 주세요.");
            }
        });
    }

    @PluginMethod public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ((MainActivity) getActivity()).closeAuthTab();
                call.resolve();
            } catch (Exception error) {
                call.reject("인증 창의 닫기 버튼을 눌러 노트로 돌아와 주세요.");
            }
        });
    }
}
