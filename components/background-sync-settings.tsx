"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getBackground, getServerBackground, subscribeBackground, refreshBackground, openBackgroundSettings } from "@/lib/background-sync";

export default function BackgroundSyncSettings(){
  const status=useSyncExternalStore(subscribeBackground,getBackground,getServerBackground);
  const [error,setError]=useState("");
  useEffect(()=>{void refreshBackground().catch(()=>setError("설정 상태를 읽지 못했어요. 다시 열어 주세요."));},[]);
  if(!status)return null;
  const action=(kind:"battery"|"data"|"app"|"unused")=>{setError("");void openBackgroundSettings(kind).catch(()=>setError("설정을 열지 못했어요. Android 앱 정보에서 확인해 주세요."));};
  const needs=status.backgroundRestricted||!status.batteryAllowed||status.dataRestricted||status.unusedRestricted;
  const messages:Record<string,string>={waiting:"첫 백그라운드 동기화 대기",running:"백그라운드에서 동기화 중",ok:"최근 백그라운드 동기화 완료",retry:"연결 복구 후 자동 재시도",auth:"앱에서 Tailscale 재인증 필요",foreground:"앱에서 동기화 이어서 진행",skipped:status.enabled?"다음 자동 동기화 대기":"로그인 후 자동 동기화 시작",busy:"다른 동기화가 끝나면 재시도"};
  return <section className="background-sync-settings" aria-label="백그라운드 자동 동기화">
    <h3>앱을 닫아도 자동 동기화</h3>
    <p>{status.enabled?"알림 없이 자동 동기화가 켜져 있어요.":"로그인하면 자동 동기화가 켜져요."} Android가 약 15분 간격으로 실행하며 절전 상태에서는 늦어질 수 있어요.</p>
    <p>{messages[status.outcome]??"자동 동기화 대기"}{status.lastSuccess>0&&<> · {new Date(status.lastSuccess).toLocaleString("ko-KR")}</>}</p>
    {!needs&&status.unusedStatus!==0&&<p className="background-sync-ready">필요한 백그라운드 설정이 모두 허용됐어요.</p>}
    {status.backgroundRestricted&&<div><p>백그라운드 실행이 제한돼 있어요. 앱 정보 → 배터리에서 ‘제한 없음’을 선택해 주세요.</p><button type="button" onClick={()=>action("app")}>백그라운드 제한 해제하기</button></div>}
    {!status.batteryAllowed&&<div><p>배터리 최적화가 동기화를 미룰 수 있어요. 다음 화면에서 이 앱의 제한 해제를 허용해 주세요.</p><button type="button" onClick={()=>action("battery")}>배터리 사용 제한 해제하기</button></div>}
    {status.dataRestricted&&<div><p>데이터 절약 모드가 통신을 제한하고 있어요.</p><button type="button" onClick={()=>action("data")}>백그라운드 데이터 허용하기</button></div>}
    {status.unusedRestricted&&<div><p>오래 사용하지 않으면 앱 활동이나 권한이 자동으로 중지돼요. 다음 화면에서 ‘사용하지 않는 앱 활동 일시중지’ 또는 ‘권한 자동 삭제’를 꺼 주세요.</p><button type="button" onClick={()=>action("unused")}>미사용 앱 자동 중지 해제하기</button></div>}
    {status.unusedStatus===0&&<p>미사용 앱 자동 중지 상태는 이 기기에서 확인하지 못했어요.</p>}
    {error&&<p role="alert">{error}</p>}
    <small>설정에서 돌아오면 자동으로 확인해요. Android에서 ‘강제 종료’한 뒤에는 앱을 다시 열어야 해요.</small>
  </section>;
}
