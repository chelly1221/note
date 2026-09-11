import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { liveQuery } from "dexie";
import { ensureTailscale, suspendTailscale, getTailscaleSnapshot } from "./tailscale";
import { connectionSettings, syncNow } from "./sync";

export type BackgroundStatus = { enabled:boolean; batteryAllowed:boolean; backgroundRestricted:boolean; dataRestricted:boolean; unusedRestricted:boolean; unusedStatus:number; lastAttempt:number; lastSuccess:number; outcome:string };
const native=registerPlugin<{
  configure(options:{enabled:boolean}):Promise<BackgroundStatus>;
  status():Promise<BackgroundStatus>;
  requestSetup():Promise<BackgroundStatus>;
  openSettings(options:{kind:"battery"|"data"|"app"|"unused"}):Promise<void>;
  addListener(event:"statusChanged",listener:(status:BackgroundStatus)=>void):Promise<PluginListenerHandle>;
}>("BackgroundSync");
let state:BackgroundStatus|null=null;
const listeners=new Set<()=>void>();
export const subscribeBackground=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const getBackground=()=>state;
export const getServerBackground=()=>null;
const publish=(value:BackgroundStatus)=>{state=value;for(const fn of listeners)fn();};
export const backgroundAdmitted=async()=>{return Boolean((await connectionSettings()).connected);};
export async function refreshBackground(){if(Capacitor.getPlatform()==="android")publish(await native.status());}
export const openBackgroundSettings=(kind:"battery"|"data"|"app"|"unused")=>native.openSettings({kind});

export function startBackgroundSync(){
  if(Capacitor.getPlatform()!=="android")return()=>{};
  let stopped=false,active=true;
  const subscription=liveQuery(backgroundAdmitted).subscribe({next:enabled=>{
    void native.configure({enabled}).then(value=>{if(!stopped){publish(value);if(enabled&&active)void native.requestSetup().catch(()=>{});}}).catch(()=>{});
  },error:()=>{}});
  const nativeListener=native.addListener("statusChanged",value=>{if(!stopped)publish(value);});
  const listener=App.addListener("appStateChange",({isActive})=>{
    active=isActive;
    if(!isActive){
      // Leave interactive authentication alive while its Custom Tab covers the app.
      if(getTailscaleSnapshot().state!=="NeedsLogin"&&getTailscaleSnapshot().state!=="NeedsMachineAuth")suspendTailscale();
      return;
    }
    void refreshBackground().catch(()=>{});
    void backgroundAdmitted().then(allowed=>{
      if(allowed&&!stopped){
        if(getTailscaleSnapshot().state==="Error")suspendTailscale();
        void ensureTailscale().then(async()=>{await syncNow();}).catch(()=>{});
      }
    });
  });
  return()=>{stopped=true;subscription.unsubscribe();void listener.then(l=>l.remove());void nativeListener.then(l=>l.remove());};
}
