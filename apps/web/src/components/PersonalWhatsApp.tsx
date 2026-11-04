import {useState} from 'react';
import {Link2, Send, ShieldAlert, Unlink} from 'lucide-react';
import type {usePersonalWhatsApp} from '../hooks/usePersonalWhatsApp';
type Personal = ReturnType<typeof usePersonalWhatsApp>;

export function PersonalWhatsAppConnection({wa}:{wa:Personal}) {
  const [phone,setPhone]=useState(''); const [risk,setRisk]=useState(false);
  if(wa.status==='unavailable') return null;
  return <section className="work-card settings-card personal-whatsapp" aria-labelledby="whatsapp-link-title">
    <div className="section-heading"><span className="step-icon"><Link2 size={18}/></span><div><span className="section-kicker">OWNER ONLY</span><h2 id="whatsapp-link-title">Personal WhatsApp connection</h2></div><span className="settings-badge">{wa.status.replaceAll('_',' ')}</span></div>
    <p className="card-description">Use your phone to link this website. You choose the recipient and confirm each send.</p>
    <p className="wa-risk"><ShieldAlert size={18}/><span>This is an unofficial linked device. WhatsApp warns that unofficial connections may compromise or ban an account. <a href="https://faq.whatsapp.com/378279804439436/" target="_blank" rel="noreferrer">Read WhatsApp’s warning</a>.</span></p>
    {wa.status==='disconnected' && <form onSubmit={e=>{e.preventDefault();if(risk)void wa.connect(phone);}}><label className="wa-label">Your WhatsApp number, including country code<input type="tel" autoComplete="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+234…"/></label><label className="wa-check"><input type="checkbox" checked={risk} onChange={e=>setRisk(e.target.checked)}/> I understand the risk and want to link my account.</label><button className="button-primary" disabled={!risk || wa.busy}>Link WhatsApp</button></form>}
    {(wa.status==='connecting'||wa.status==='awaiting_confirmation') && <div className="wa-pair"><strong>{wa.code ? 'Enter this code in WhatsApp' : 'Preparing your pairing code…'}</strong>{wa.code && <><output className="wa-code">{wa.code}</output><p>In WhatsApp, open Linked devices, choose Link a device, then Link with phone number. Never share this code.</p></>}</div>}
    {wa.status==='connected' && <p className="settings-explain">Connected. Select a completed note to send it.</p>}
    {wa.status==='error' && <p className="settings-explain">The link could not be completed. Disconnect, then try again.</p>}
    {wa.status!=='disconnected' && <button className="button-outline" disabled={wa.busy} onClick={()=>void wa.disconnect()}><Unlink size={15}/> Disconnect</button>}
    {wa.error && <p role="alert" className="inline-alert error">{wa.error}</p>}
  </section>;
}
export function PersonalWhatsAppSend({wa,jobId}:{wa:Personal;jobId:string}) {
  const [recipient,setRecipient]=useState(''); const [preview,setPreview]=useState(false);const [consent,setConsent]=useState(false);const [busy,setBusy]=useState(false);const [result,setResult]=useState('');
  if(wa.status!=='connected') return null;
  const submit=async () => {
    if(!preview || !consent || busy) return;
    setBusy(true);setResult('');
    try { const response=await wa.send(jobId,recipient,crypto.randomUUID());setResult(response.status==='accepted' ? 'WhatsApp accepted the voice note. Check the chat for its delivery status.' : 'Send status is unknown. Check WhatsApp before trying again to avoid a duplicate.'); }
    catch {setResult('Send status could not be confirmed. Check WhatsApp before trying again to avoid a duplicate.');}
    finally {setBusy(false);}
  };
  return <section className="personal-send" aria-labelledby="wa-send-title"><h3 id="wa-send-title">Send through linked WhatsApp</h3><p>Enter the recipient’s number with country code. Review the audio before sending.</p><label className="wa-label">Recipient phone number<input type="tel" autoComplete="tel" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="+234…"/></label><label className="wa-check"><input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)}/> I listened to this translation.</label><label className="wa-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> The recipient agreed to receive this message.</label><button className="button-primary" disabled={busy||!recipient||!preview||!consent} onClick={()=>void submit()}><Send size={15}/>{busy?'Sending…':'Confirm and send'}</button>{result&&<p role="status" className="settings-explain">{result}</p>}</section>;
}
