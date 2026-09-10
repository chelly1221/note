package kr.threechan.note;

import static org.junit.Assert.*;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run only on a disposable emulator with networking disabled and cleared debug app data. */
@RunWith(AndroidJUnit4.class)
public class OfflineStartupTest {
    private String js(ActivityScenario<MainActivity> app,String script)throws Exception{
        AtomicReference<String> value=new AtomicReference<>("");
        CountDownLatch done=new CountDownLatch(1);
        app.onActivity(a->a.getBridge().getWebView().evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        assertTrue(done.await(5,TimeUnit.SECONDS));return value.get();
    }
    private void await(ActivityScenario<MainActivity> app,String expression)throws Exception{
        for(int i=0;i<80;i++){if("true".equals(js(app,expression)))return;SystemClock.sleep(100);}
        fail("Offline app startup did not reach: "+expression);
    }
    private void offline(ActivityScenario<MainActivity> app){
        app.onActivity(a->{
            a.getBridge().getWebView().getSettings().setBlockNetworkLoads(true);
            a.getBridge().getWebView().setNetworkAvailable(false);
        });
    }
    @Test public void localContentSurvivesRelaunchWithoutConnectionGate()throws Exception{
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            offline(app);
            await(app,"document.body.innerText.length>10 && !document.body.innerText.includes('여는 중')");
            assertEquals("Disable Wi-Fi/data on the test emulator first","false",js(app,"navigator.onLine"));
            js(app,"(()=>{const open=indexedDB.open('note');open.onerror=()=>window.__localSeed='error';open.onsuccess=()=>{const db=open.result;const tx=db.transaction([\"notes\",\"settings\"],'readwrite');tx.objectStore('settings').put({key:'connection',value:{connected:true,serverUrl:'https://audax-vm.tail62313c.ts.net:8443',deviceName:'Offline QA',storageId:'local-fixture',login:'offline-fixture'}});tx.objectStore('notes').put({id:'local-qa',title:'로컬 노트 검증',content:'인터넷 없이 이 기기에 저장한 기록',folder:'기본 노트',tags:[],pinned:false,deletedAt:null,createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z',revision:0,attachments:[],dirty:true,syncState:1,mutationId:'local-qa-mutation'});tx.oncomplete=()=>{db.close();window.__localSeed='ready';};tx.onerror=()=>window.__localSeed='error';};})()");
            await(app,"window.__localSeed==='ready'");
        }
        try(ActivityScenario<MainActivity> app=ActivityScenario.launch(MainActivity.class)){
            offline(app);
            await(app,"document.body.innerText.includes('로컬 노트 검증') && !document.querySelector('.access-page, main.gate')");
            assertEquals("false",js(app,"navigator.onLine"));
            assertEquals("false",js(app,"Boolean(document.querySelector('.access-page, main.gate'))"));
        }
    }
}
