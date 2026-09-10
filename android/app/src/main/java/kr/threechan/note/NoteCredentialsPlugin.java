package kr.threechan.note;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NoteCredentials")
public class NoteCredentialsPlugin extends Plugin {
    private CredentialStore credentials;

    @Override public void load() { credentials = new CredentialStore(getContext()); }

    @PluginMethod public void get(PluginCall call) {
        try {
            JSObject result = new JSObject();
            String value = credentials.get();
            if (value != null) result.put("value", value);
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not access the secure session."); }
    }

    @PluginMethod public void set(PluginCall call) {
        try { credentials.set(call.getString("value")); call.resolve(); }
        catch (Exception error) { call.reject("Could not store the session securely."); }
    }

    @PluginMethod public void remove(PluginCall call) {
        try { credentials.remove(); call.resolve(); }
        catch (Exception error) { call.reject("Could not clear the session."); }
    }
}
