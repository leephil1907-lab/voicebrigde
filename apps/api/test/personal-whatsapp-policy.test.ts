import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { authorizePilot, validatePilotSend, PilotPolicyError } from '../src/pilot/personal-whatsapp-policy.js';
const policy = {enabled:true,ownerUserId:'owner'};
const request = {userId:'owner',jobOwnerId:'owner',jobStatus:'completed',recipient:'+234 800 000 0000',previewConfirmed:true,recipientConsented:true};
test('pilot is disabled by default and restricted to a single configured owner', () => {
  for (const [p, id] of [[{enabled:false,ownerUserId:'owner'},'owner'],[{enabled:true,ownerUserId:undefined},'owner'],[policy,'other']] as const) assert.throws(()=>authorizePilot(p,id),PilotPolicyError);
  assert.doesNotThrow(()=>authorizePilot(policy,'owner'));
});
test('pilot validation requires an owned completed note, preview and recipient consent', () => {
  for (const change of [{jobOwnerId:'other'},{jobStatus:'processing'},{previewConfirmed:false},{recipientConsented:false},{recipient:'not a number'}]) assert.throws(()=>validatePilotSend(policy,{...request,...change}),PilotPolicyError);
  assert.equal(validatePilotSend(policy,request).recipient,'2348000000000');
});
