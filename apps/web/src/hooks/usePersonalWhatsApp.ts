import {useCallback, useEffect, useRef, useState} from 'react';
import {apiRequest, ApiError} from '../lib/api';

type Status = 'unavailable'|'disconnected'|'connecting'|'awaiting_confirmation'|'connected'|'error';
export function usePersonalWhatsApp(userId:string | undefined, getToken:()=>Promise<string>) {
  const [status,setStatus]=useState<Status>('unavailable'); const [code,setCode]=useState(''); const [error,setError]=useState('');
  const [busy,setBusy]=useState(false); const codeRequested=useRef(false); const generation=useRef(0);
  const call=useCallback(async <T,>(path:string,body?:unknown) => apiRequest<T>(`/v1/personal-whatsapp/${path}`,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(path==='send' ? {signal:AbortSignal.timeout(120_000)} : {})},await getToken()),[getToken]);
  const refresh=useCallback(async () => {
    if(!userId) return;
    const current=generation.current;
    try {
      const data=await call<{status:Status}>('status'); if(current!==generation.current) return; setStatus(data.status);
      if(data.status === 'awaiting_confirmation' && !codeRequested.current) {
        codeRequested.current=true;
        try { const result=await call<{code:string|null}>('pairing-code',{}); if(current!==generation.current) return; if(result.code) setCode(result.code); else codeRequested.current=false; }
        catch {codeRequested.current=false;}
      }
      if(data.status === 'connected') setCode('');
    } catch(e) { if(current!==generation.current) return; if(e instanceof ApiError && e.status === 404) setStatus('unavailable'); else setError('Could not check WhatsApp connection.'); }
  },[call,userId]);
  useEffect(() => {
    generation.current++; setCode(''); setError(''); setStatus('unavailable'); codeRequested.current=false;
    if(!userId) return;
    void refresh();
    return () => { generation.current++; };
  },[userId,refresh]);
  useEffect(() => {
    if (!userId || !['connecting','awaiting_confirmation','connected'].includes(status)) return;
    const timer=window.setInterval(() => void refresh(), status==='connected' ? 10_000 : 4_000);
    return () => window.clearInterval(timer);
  },[userId,status,refresh]);
  useEffect(() => { if (!code) return; const timer=window.setTimeout(() => setCode(''),80_000); return () => window.clearTimeout(timer); },[code]);
  const connect=async (phone:string) => {setBusy(true);setError('');setCode('');codeRequested.current=false;try{await call('connect',{phone});await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not connect.');}finally{setBusy(false);}};
  const disconnect=async () => {setBusy(true);setError('');try{await call('disconnect',{});setStatus('disconnected');setCode('');codeRequested.current=false;}catch(e){setError(e instanceof Error?e.message:'Disconnect could not be confirmed. Check linked devices in WhatsApp.');await refresh();}finally{setBusy(false);}};
  const send=async (jobId:string,recipient:string,attemptId:string) => call<{status:'accepted'|'unknown';messageId?:string}>('send',{jobId,recipient,attemptId,previewConfirmed:true,recipientConsented:true});
  return {status,code,error,busy,connect,disconnect,send};
}
