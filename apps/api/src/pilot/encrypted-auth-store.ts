import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap } from '@whiskeysockets/baileys';

/** Storage is an adapter: implementations must make each writeBatch atomic.
 * No API endpoint currently instantiates this store. */
export interface AuthRecordStore {
  read(owner: string, names: string[]): Promise<Record<string, string>>;
  writeBatch(owner: string, values: Record<string, string | null>): Promise<void>;
  clear(owner: string): Promise<void>;
}

export class EncryptedAuthStore {
  private readonly key: Buffer;
  constructor(private readonly store: AuthRecordStore, private readonly owner: string, keyBase64: string) {
    if (!owner) throw new Error('An owner is required.');
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== keyBase64) throw new Error('Encryption key must be a canonical base64-encoded 32-byte key.');
  }
  private aad(name: string) { return Buffer.from(JSON.stringify(['voicebridge-whatsapp-v1', this.owner, name])); }
  private encrypt(name: string, value: unknown): string {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(this.aad(name));
    const plaintext = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
  }
  private decrypt(name: string, encoded: string): unknown {
    const payload = JSON.parse(encoded) as { v: number; iv: string; tag: string; data: string };
    if (payload.v !== 1) throw new Error('Unsupported encrypted session version.');
    const iv = Buffer.from(payload.iv, 'base64'); const tag = Buffer.from(payload.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted session.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(this.aad(name)); cipher.setAuthTag(tag);
    const plaintext = Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]);
    return JSON.parse(plaintext.toString('utf8'), BufferJSON.reviver);
  }
  async clear(): Promise<void> { await this.store.clear(this.owner); }
  async load(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const records = await this.store.read(this.owner, ['creds']);
    // Never silently replace corrupt or undecryptable credentials with a new session.
    const creds = records.creds ? this.decrypt('creds', records.creds) as AuthenticationState['creds'] : initAuthCreds();
    const state: AuthenticationState = { creds, keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const names = ids.map(id => JSON.stringify([type, id])); const records = await this.store.read(this.owner, names);
        const result: Record<string, SignalDataTypeMap[T]> = {};
        for (let i = 0; i < ids.length; i++) {
          if (!records[names[i]]) continue;
          let value = this.decrypt(names[i], records[names[i]]);
          if (type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
          result[ids[i]] = value as SignalDataTypeMap[T];
        }
        return result;
      },
      set: async (data: SignalDataSet) => {
        const updates: Record<string, string | null> = {};
        for (const [category, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries || {})) {
          const name = JSON.stringify([category, id]); updates[name] = value == null ? null : this.encrypt(name, value);
        }
        if (Object.keys(updates).length) await this.store.writeBatch(this.owner, updates);
      },
      clear: () => this.store.clear(this.owner),
    } };
    return { state, saveCreds: () => this.store.writeBatch(this.owner, { creds: this.encrypt('creds', state.creds) }) };
  }
}
