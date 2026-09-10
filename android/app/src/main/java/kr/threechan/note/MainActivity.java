package kr.threechan.note;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NoteCredentialsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
