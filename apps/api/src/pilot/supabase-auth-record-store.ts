import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthRecordStore } from './encrypted-auth-store.js';

/** Uses a privileged server-side client only. The caller must enforce owner
 * authorization before constructing or accessing any account's session. */
export class SupabaseAuthRecordStore implements AuthRecordStore {
  constructor(private readonly db: SupabaseClient) {}
  async read(owner: string, names: string[]): Promise<Record<string,string>> {
    if (!names.length) return {};
    const {data, error} = await this.db.from('voicebridge_whatsapp_session_records').select('record_name,encrypted_value').eq('owner_id', owner).in('record_name', names);
    if (error) throw new Error('Could not read protected WhatsApp session.');
    return Object.fromEntries((data || []).map(row => [row.record_name, row.encrypted_value]));
  }
  async writeBatch(owner: string, values: Record<string,string|null>): Promise<void> {
    const {error} = await this.db.rpc('voicebridge_whatsapp_session_write', {p_owner: owner, p_values: values});
    if (error) throw new Error('Could not save protected WhatsApp session.');
  }
  async clear(owner: string): Promise<void> {
    const {error} = await this.db.from('voicebridge_whatsapp_session_records').delete().eq('owner_id', owner);
    if (error) throw new Error('Could not remove protected WhatsApp session.');
  }
}
