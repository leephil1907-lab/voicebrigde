import makeWASocket, { Browsers, prepareWAMessageMedia, generateWAMessageFromContent, type AuthenticationState } from '@whiskeysockets/baileys';
import pino from 'pino';
import { normalizePhone } from '../audio.js';
import { authorizePilot, type PilotPolicy } from './personal-whatsapp-policy.js';
import type { EncryptedAuthStore } from './encrypted-auth-store.js';

type Phase = 'disconnected' | 'connecting' | 'awaiting_confirmation' | 'connected' | 'error';
type Update = { connection?: 'connecting' | 'open' | 'close'; qr?: string; lastDisconnect?: {error?:unknown} };
export interface PairingSocket {
  onUpdate(callback: (update: Update) => void): void;
  onCredentials(callback: () => void): void;
  requestPairingCode(phone: string): Promise<string>;
  sendVoice(jid: string, audio: Buffer, waveform: Uint8Array, seconds: number): Promise<string>;
  logout(): Promise<void>;
  end(): Promise<void>;
}
export type SocketFactory = (state: AuthenticationState) => PairingSocket;

/** Unofficial transport; this never logs or exposes QR payloads, codes, or session keys. */
export const makeLinkedSocket: SocketFactory = state => {
  const socket = makeWASocket({ auth: state, logger: pino({level:'silent'}), browser: Browsers.ubuntu('Chrome'), syncFullHistory: false, shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false });
  return {
    onUpdate: callback => { socket.ev.on('connection.update', callback); },
    onCredentials: callback => { socket.ev.on('creds.update', callback); },
    requestPairingCode: phone => socket.requestPairingCode(phone),
    sendVoice: async (jid, audio, waveform, seconds) => {
      if (!socket.user?.id) throw new Error('WhatsApp is not connected.');
      const media = await prepareWAMessageMedia({audio, mimetype:'audio/ogg; codecs=opus', ptt:true}, {upload:socket.waUploadToServer});
      if (!media.audioMessage) throw new Error('Could not prepare voice note.');
      const content = {...media, audioMessage:{...media.audioMessage, ptt:true, waveform, seconds, mimetype:'audio/ogg; codecs=opus'}};
      const message = generateWAMessageFromContent(jid,content,{userJid:socket.user.id});
      if (!message.message || !message.key.id) throw new Error('Could not create voice note.');
      await socket.relayMessage(jid,message.message,{messageId:message.key.id});
      return message.key.id;
    },
    logout: () => socket.logout(),
    end: () => socket.end(undefined),
  };
};

/** Owner-only coordinator. No HTTP endpoint or frontend calls this class yet.
 * It never auto-retries message sends; it handles one pairing restart request. */
export class LinkedDevicePairing {
  private phase: Phase = 'disconnected';
  private socket: PairingSocket | null = null;
  private code: { value: string; expires: number } | null = null;
  private serial = 0;
  private saving: Promise<void> = Promise.resolve();
  private pendingPhone: string | null = null;
  private codeRequested = false;
  private resumePhone: string | null = null;
  private restartUsed = false;
  constructor(private readonly policy: PilotPolicy, private readonly vault: EncryptedAuthStore, private readonly factory: SocketFactory = makeLinkedSocket) {}
  status(userId: string): Phase { authorizePilot(this.policy,userId); return this.phase; }
  takePairingCode(userId: string): string | null {
    authorizePilot(this.policy,userId);
    const value = this.code && this.code.expires > Date.now() ? this.code.value : null;
    this.code = null;
    return value;
  }
  async connect(userId: string, phone: string): Promise<void> {
    authorizePilot(this.policy,userId);
    this.restartUsed = false;
    return this.start(userId,phone);
  }
  private async start(userId: string, phone: string): Promise<void> {
    authorizePilot(this.policy,userId);
    if (this.phase !== 'disconnected') throw new Error('A connection is already in progress or active.');
    const normalized = normalizePhone(phone);
    const serial = ++this.serial; this.phase = 'connecting'; this.code = null; this.pendingPhone = normalized; this.resumePhone = normalized; this.codeRequested = false;
    try {
      const {state, saveCreds} = await this.vault.load();
      if (serial !== this.serial) return;
      const socket = this.factory(state); this.socket = socket;
      socket.onCredentials(() => {
        if (serial !== this.serial) return;
        this.saving = this.saving.then(() => serial === this.serial ? saveCreds() : undefined).catch(async () => {
          if (serial !== this.serial) return;
          this.phase = 'error'; this.code = null; this.pendingPhone = null;
          await socket.end().catch(() => {});
          throw new Error('Could not protect WhatsApp session.');
        });
        void this.saving.catch(() => {});
      });
      socket.onUpdate(update => {
        if (serial !== this.serial) return;
        if (update.qr && !state.creds.registered && this.pendingPhone && !this.codeRequested) {
          this.codeRequested = true;
          const number = this.pendingPhone; this.pendingPhone = null;
          void socket.requestPairingCode(number).then(value => {
            if (serial !== this.serial || this.phase !== 'connecting') return;
            this.code = {value,expires:Date.now()+90_000}; this.phase = 'awaiting_confirmation';
          }).catch(() => { if (serial === this.serial) { this.phase = 'error'; this.code = null; void socket.end().catch(() => {}); } });
        }
        if (update.connection === 'open') {
          void this.saving.then(() => { if (serial === this.serial && this.socket === socket && this.phase !== 'error') { this.phase = 'connected'; this.code = null; this.pendingPhone = null; this.resumePhone = null; } }).catch(() => {});
        }
        if (update.connection === 'close' && this.phase !== 'error') {
          const status = (update.lastDisconnect?.error as {output?:{statusCode?:number}} | undefined)?.output?.statusCode;
          const retryPhone = this.resumePhone;
          this.code = null; this.pendingPhone = null; this.socket = null;
          // WhatsApp may request one immediate restart after successful pairing.
          // Never retry messages; all other disconnects require an explicit reconnect.
          if (status === 515 && retryPhone && !this.restartUsed) {
            this.restartUsed = true; this.phase = 'connecting';
            void this.saving.then(async () => {
              if (serial !== this.serial) return;
              this.phase = 'disconnected'; await this.start(userId,retryPhone);
            }).catch(() => { if (serial === this.serial) this.phase = 'error'; });
          } else { this.phase = 'disconnected'; this.resumePhone = null; }
        }
      });
    } catch {
      if (serial === this.serial) { this.phase = 'error'; this.pendingPhone = null; this.code = null; }
      throw new Error('Could not start the protected WhatsApp connection.');
    }
  }
  async sendVoice(userId: string, recipient: string, audio: Buffer, waveform: Uint8Array, seconds: number): Promise<{status:'accepted'; messageId:string} | {status:'unknown'}> {
    authorizePilot(this.policy,userId);
    if (this.phase !== 'connected' || !this.socket) throw new Error('WhatsApp is not connected.');
    const number = normalizePhone(recipient);
    if (audio.length < 4 || audio.length > 16 * 1024 * 1024 || audio.subarray(0,4).toString('ascii') !== 'OggS') throw new Error('Invalid voice note.');
    if (waveform.length !== 64 || [...waveform].some(x=>x>100) || !Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('Invalid waveform.');
    try { const messageId = await this.socket.sendVoice(`${number}@s.whatsapp.net`,audio,waveform,seconds); return {status:'accepted',messageId}; }
    catch { return {status:'unknown'}; } // Never retry an ambiguous send.
  }
  async disconnect(userId: string): Promise<void> {
    authorizePilot(this.policy,userId);
    ++this.serial; this.code = null; this.pendingPhone = null; this.resumePhone = null; this.phase = 'disconnected';
    const socket = this.socket; this.socket = null;
    let logoutFailed = false;
    if (socket) { try { await socket.logout(); } catch { logoutFailed = true; } finally { await socket.end().catch(() => {}); } }
    await this.saving.catch(() => {}); this.saving = Promise.resolve();
    if (!socket) logoutFailed = true;
    await this.vault.clear();
    if (logoutFailed) throw new Error('Local session removed, but WhatsApp could not confirm logout. Remove the linked device in WhatsApp.');
  }
}
