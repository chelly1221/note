import { connectionSettings, syncNow, getSyncSnapshot } from "./sync";
import { runBackgroundSync } from "./background-runner";

declare global { interface Window { BackgroundSyncNative?: { invoke(method:string,input:string):string } } }
const bridge=window.BackgroundSyncNative;
const invoke=(method:string,args:unknown)=>{const result=JSON.parse(bridge!.invoke(method,JSON.stringify(args)));if(result.error)throw new Error(result.error);};
if(bridge)void runBackgroundSync(async()=>{return Boolean((await connectionSettings()).connected);},async()=>{
 const before=getSyncSnapshot().lastSyncedAt;
 await syncNow();
 const state=getSyncSnapshot();return state.state==='idle'&&state.lastSyncedAt!==before&&state.pending===0;
}).catch(()=>"retry").then(outcome=>invoke("finish",{outcome}));
