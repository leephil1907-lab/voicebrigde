import makeWASocket, { Browsers, type AuthenticationState } from '@whiskeysockets/baileys';
import pino from 'pino';
import { normalizePhone } from '../audio.js';
import { authorizePilot, type PilotPolicy } from './personal-whatsapp-policy.js';
import type { EncryptedAuthStore } from './encrypted-auth-store.js';

type Phase = 'disconnected' | 'connecting' | 'awaiting_confirmation' | 'connected' | 'error';
type Update = { connection?: 'connecting' | 'open' | 'close'; qr?: string };
export interface PairingSocket {
  onUpdate(callback: (update: Update) => void): void;
  onCredentials(callback: () => void): void;
  requestPairingCode(phone: string): Promise<string>;
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
    logout: () => socket.logout(),
    end: () => socket.end(undefined),
  };
};

/** Owner-only coordinator. No HTTP endpoint or frontend calls this class yet.
 * It intentionally does not auto-retry connection or message sends. */
export class LinkedDevicePairing {
  private phase: Phase = 'disconnected';
  private socket: PairingSocket | null = null;
  private code: { value: string; expires: number } | null = null;
  private serial = 0;
  private saving: Promise<void> = Promise.resolve();
  private pendingPhone: string | null = null;
  private codeRequested = false;
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
    if (this.phase !== 'disconnected') throw new Error('A connection is already in progress or active.');
    const normalized = normalizePhone(phone);
    const serial = ++this.serial; this.phase = 'connecting'; this.code = null; this.pendingPhone = normalized; this.codeRequested = false;
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
          void this.saving.then(() => { if (serial === this.serial) { this.phase = 'connected'; this.code = null; this.pendingPhone = null; } }).catch(() => {});
        }
        if (update.connection === 'close' && this.phase !== 'error') { this.phase = 'disconnected'; this.code = null; this.pendingPhone = null; this.socket = null; }
      });
    } catch {
      if (serial === this.serial) { this.phase = 'error'; this.pendingPhone = null; this.code = null; }
      throw new Error('Could not start the protected WhatsApp connection.');
    }
  }
  async disconnect(userId: string): Promise<void> {
    authorizePilot(this.policy,userId);
    ++this.serial; this.code = null; this.pendingPhone = null; this.phase = 'disconnected';
    const socket = this.socket; this.socket = null;
    let logoutFailed = false;
    if (socket) { try { await socket.logout(); } catch { logoutFailed = true; } finally { await socket.end().catch(() => {}); } }
    await this.saving.catch(() => {}); this.saving = Promise.resolve();
    if (!socket) logoutFailed = true;
    await this.vault.clear();
    if (logoutFailed) throw new Error('Local session removed, but WhatsApp could not confirm logout. Remove the linked device in WhatsApp.');
  }
}
