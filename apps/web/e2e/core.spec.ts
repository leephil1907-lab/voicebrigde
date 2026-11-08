import { test, expect, type Page } from '@playwright/test';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'person@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const jwt = ['eyJhbGciOiJub25lIn0', Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url'), 'signature'].join('.');
const session = { access_token: jwt, refresh_token: 'test-refresh-token', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user };
const jobId = '22222222-2222-4222-8222-222222222222';
async function setup(page: Page) {
  await page.route('**/config', route => route.fulfill({ json: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'test-public-key', maxAudioBytes: 20971520, maxAudioSeconds: 120, targetLanguages: ['es','fr'], channels: { whatsapp: false, telegram: false } } }));
  await page.route('**/health', route => route.fulfill({ json: { status: 'ok', capabilities: { authentication: true, durableJobs: true, privateAudioStorage: true, audioToAudioDubbing: true } } }));
  await page.route('https://example.supabase.co/auth/v1/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*' } });
    if (url.pathname.endsWith('/signup')) return route.fulfill({ json: { user, session: null } });
    if (url.pathname.endsWith('/token')) return route.fulfill({ json: session });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: user });
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
    return route.fulfill({ json: {} });
  });
  await page.route('**/v1/voice/translations', route => route.fulfill({ json: { items: [] } }));
}
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Sign in', exact: false }).first().click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Email address').fill(user.email); await dialog.getByLabel('Password', { exact: true }).fill('password123');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(dialog).not.toBeVisible();
}
test('registration clearly requests email confirmation and sign in persists across reload', async ({page}) => {
  await setup(page); await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: false }).first().click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Create an account' }).click();
  await dialog.getByLabel('Email address').fill(user.email); await dialog.getByLabel('Create password', { exact: true }).fill('password123'); await dialog.getByLabel('I agree to the Terms and Privacy Policy.').check(); await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Check your email');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByLabel('Password', { exact: true }).fill('password123'); await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: 'Open my account' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: 'Open my account' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my account' }).click();
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await expect(page.locator('.account-profile')).toContainText(user.email);
  await page.getByRole('button', { name: 'Sign out' }).click(); await expect(page.getByRole('button', { name: 'Sign in', exact: false }).first()).toBeVisible();
});
test('recording, consent, submission and completed preview use the API', async ({page}) => {
  await setup(page); await page.route('**/v1/voice/translate', async route => { const payload = route.request().postData() || ''; expect(payload).toContain('voiceConsent'); expect(payload).toContain('true'); expect(payload).toContain('targetLanguage'); expect(payload).toContain('fr'); await route.fulfill({ status: 202, json: { id: jobId } }); });
  await page.route(`**/v1/voice/translations/${jobId}`, route => route.fulfill({ json: { id:jobId, status:'completed', stage:'completed', targetLanguage:'fr', sourceLanguage:'en', sourceTranscript:'Hello', translatedTranscript:'Bonjour', audioUrl:'http://localhost:3000/fake.ogg', error:null, createdAt:new Date().toISOString(), completedAt:new Date().toISOString() } }));
  await page.goto('/'); await signIn(page); await page.getByRole('button',{name:'Start recording'}).click(); await page.waitForTimeout(1300); await page.getByRole('button',{name:'Stop recording'}).click();
  await expect(page.getByText('Original recording ·', { exact: false })).toBeVisible();
  await page.getByLabel('Translate into').selectOption('fr'); await page.getByLabel("I confirm this is my voice, or I have the speaker's permission to reproduce it.").check();
  await page.getByRole('button',{name:'Translate voice note'}).click(); await expect(page.getByText('French voice note', { exact: false }).last()).toBeVisible({timeout:15000});
  await expect(page.getByRole('button',{name:'Download audio'})).toBeVisible();
});

test('read a note sends only consented audio and displays English text', async ({page}) => {
  await setup(page);
  await page.route('**/v1/voice/understand', async route => { const payload = route.request().postData() || ''; expect(payload).toContain('processingConsent'); expect(payload).toContain('true'); await route.fulfill({ json: { sourceText:'Bonjour', englishText:'Hello', sourceLanguage:'fra', translationStatus:'completed' } }); });
  await page.goto('/'); await signIn(page); await page.getByRole('button',{name:'Read a voice note'}).click();
  await page.locator('input[type=file]').setInputFiles({ name:'incoming.ogg', mimeType:'audio/ogg', buffer:Buffer.from('test audio') });
  await page.getByLabel('I have permission to send this recording to the transcription provider.').check();
  await page.getByRole('button',{name:'Convert to English',exact:true}).click();
  await expect(page.getByText('Hello',{exact:true})).toBeVisible(); await page.getByText('View original transcript',{exact:false}).click(); await expect(page.getByText('Bonjour',{exact:true})).toBeVisible();
});

test('language selectors display representative flags without changing language codes', async ({page}) => {
  await setup(page); await page.goto('/');
  const source = page.getByLabel('Spoken language'); const target = page.getByLabel('Translate into');
  await expect(source.locator('option[value="auto"]')).toContainText('Detect automatically');
  await expect(source.locator('option[value="en"]')).toHaveText('🇬🇧 English');
  await expect(target.locator('option[value="fr"]')).toHaveText('🇫🇷 French · Français');
  await target.selectOption('fr'); await expect(target).toHaveValue('fr');
  await expect(page.getByText('Flags are representative; languages are spoken in many places.')).toBeVisible();
});

test('invalid credentials surface an error and do not sign in', async ({page}) => {
  await setup(page); await page.route('https://example.supabase.co/auth/v1/token**', route => route.fulfill({status:400,json:{error:'invalid_grant',error_description:'Invalid login credentials'}}));
  await page.goto('/'); await page.getByRole('button',{name:'Sign in',exact:false}).first().click();
  const dialog=page.getByRole('dialog'); await dialog.getByLabel('Email address').fill(user.email); await dialog.getByLabel('Password',{exact:true}).fill('incorrect'); await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Invalid login credentials'); await expect(dialog).toBeVisible();
});

test('document head exposes consistent crawlable branding and social previews', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('VoiceBridge — Your voice, in every language.');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voicebridge-81xs.onrender.com/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'VoiceBridge — Your voice, in every language.');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://voicebridge-81xs.onrender.com/og-voicebridge.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', 'https://voicebridge-81xs.onrender.com/og-voicebridge.png');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  const preview = await page.request.get('http://127.0.0.1:3000/og-voicebridge.png');
  expect(preview.ok()).toBeTruthy();
  expect(preview.headers()['content-type']).toContain('image/png');
  const previewBytes = await preview.body();
  expect(previewBytes.readUInt32BE(16)).toBe(1200);
  expect(previewBytes.readUInt32BE(20)).toBe(630);
  const appleIcon = await page.request.get('http://127.0.0.1:3000/apple-touch-icon.png');
  expect(appleIcon.ok()).toBeTruthy();
  expect(appleIcon.headers()['content-type']).toContain('image/png');
  const htmlResponse = await page.request.get('http://127.0.0.1:3000/');
  const documentHtml = await htmlResponse.text();
  expect(documentHtml).toContain('<noscript>');
  expect(documentHtml).toContain('VoiceBridge');
});


test('mobile layout uses compact navigation and keeps content within the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
  const menuButton = page.getByRole('button', { name: 'Open navigation' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(page.locator('.app-sidebar')).toHaveClass(/open/);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-sidebar')).not.toHaveClass(/open/);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await nav.getByRole('button', { name: 'Read note' }).click();
  await expect(page.getByRole('heading', { name: 'Understand every message.' })).toBeVisible();
  await nav.getByRole('button', { name: 'Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await context.close();
});

test('desktop keeps the full sidebar and hides the mobile tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});


test('responsive layouts fit compact phones, tablets and desktop widths', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/');
  for (const width of [320, 360, 375, 390, 430, 600, 768, 800]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  }
  for (const width of [801, 900, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
  }
  await context.close();
});


test('mobile layout remains within narrow 320px devices', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await context.close();
});


test('mobile navigation drawer opens and closes without horizontal overflow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.app-sidebar')).toHaveClass(/open/);
  await page.locator('.app-sidebar').getByRole('button', { name: 'Close menu' }).click();
  await expect(page.locator('.app-sidebar')).not.toHaveClass(/open/);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await context.close();
});

test('workspace and footer use the full available width on mobile and desktop', async ({browser}) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({viewport:{width,height:850}});
    await setup(page); await page.goto('/');
    const layout = await page.evaluate(() => {
      const main = document.querySelector('.app-main')!.getBoundingClientRect();
      const footer = document.querySelector('.legal-links')!;
      const sidebar = document.querySelector('.app-sidebar')!.getBoundingClientRect();
      return { main: main.width, viewport: window.innerWidth, sidebar: sidebar.width, footerInside: !!footer.closest('.app-main'), overflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(layout.footerInside, `footer placement at ${width}`).toBeTruthy();
    expect(layout.overflow, `overflow at ${width}`).toBeFalsy();
    const expectedWidth = width <= 800 ? width : width - layout.sidebar;
    expect(layout.main, `workspace width at ${width}`).toBeGreaterThanOrEqual(expectedWidth - 1);
    await page.close();
  }
});

test('theme toggle persists and navigation updates across desktop and mobile', async ({browser}) => {
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({viewport:{width,height:850}, colorScheme:'light'});
    await setup(page); await page.goto('/');
    await expect(page.locator('.top-bar')).not.toContainText('Workspace');
    await page.getByRole('button',{name:'Switch to dark theme'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.getByRole('button',{name:'Switch to light theme'})).toBeVisible();
    const nav = width <= 800 ? page.getByRole('navigation',{name:'Mobile navigation'}) : page.getByRole('navigation',{name:'Main navigation'});
    await nav.getByRole('button',{name:width <= 800 ? 'Read note' : 'Read a voice note'}).click();
    await expect(page.getByRole('heading',{name:'Understand every message.'})).toBeVisible();
    await expect(nav.getByRole('button',{name:width <= 800 ? 'Read note' : 'Read a voice note'})).toHaveAttribute('aria-current','page');
    const dims = await page.evaluate(() => ({view:innerWidth,doc:document.documentElement.scrollWidth, headerRight:document.querySelector('.top-actions')!.getBoundingClientRect().right}));
    expect(dims.doc).toBeLessThanOrEqual(width); expect(dims.headerRight).toBeLessThanOrEqual(width);
    await page.getByRole('button',{name:'Switch to light theme'}).click(); await expect(page.locator('html')).toHaveAttribute('data-theme','light');
    await page.close();
  }
});

test('sharing opens the device chooser with audio and never calls the delivery API', async ({page}) => {
  await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {value: ({files}: {files: File[]}) => files.length === 1});
    Object.defineProperty(navigator, 'share', {value: async ({files}: {files: File[]}) => { (window as unknown as {sharedName: string; sharedType: string}).sharedName = files[0].name; (window as unknown as {sharedType: string}).sharedType = files[0].type; }});
  });
  await page.route('**/v1/voice/deliver', () => { throw new Error('Automatic delivery must not be called'); });
  await page.route('**/v1/voice/translate', route => route.fulfill({status:202,json:{id:jobId}}));
  await page.route(`**/v1/voice/translations/${jobId}`, route => route.fulfill({json:{id:jobId,status:'completed',stage:'completed',targetLanguage:'fr',sourceLanguage:'en',audioUrl:'http://localhost:3000/fake.ogg',error:null,createdAt:new Date().toISOString()}}));
  const header = Buffer.alloc(47); header.write('OggS', 0); header[5] = 2; header[26] = 1; header[27] = 19; header.write('OpusHead', 28); header[36] = 1; header[37] = 1;
  await page.route('**/fake.ogg', route => route.fulfill({status:200,contentType:'application/octet-stream',body:header}));
  await page.goto('/'); await signIn(page); await page.getByRole('button',{name:'Start recording'}).click(); await page.waitForTimeout(1300); await page.getByRole('button',{name:'Stop recording'}).click();
  await page.getByLabel('Translate into').selectOption('fr'); await page.getByLabel("I confirm this is my voice, or I have the speaker's permission to reproduce it.").check();
  await page.getByRole('button',{name:'Translate voice note'}).click();
  const share = page.getByRole('button',{name:'Share with an app'}).first(); await expect(share).toBeEnabled({timeout:15000}); await share.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {sharedName?: string}).sharedName)).toBe('voicebridge-fr.ogg');
  await expect.poll(() => page.evaluate(() => (window as unknown as {sharedType?: string}).sharedType)).toBe('audio/ogg');
  await expect(page.getByText('No message is sent automatically.',{exact:false}).first()).toBeVisible();
});

test('unsupported Android file sharing shows an error without sending or downloading', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', {value: () => false});
    Object.defineProperty(navigator, 'share', {value: () => { throw new Error('share must not be called'); }});
  });
  await page.route('**/v1/voice/translate', route => route.fulfill({status:202,json:{id:jobId}}));
  await page.route(`**/v1/voice/translations/${jobId}`, route => route.fulfill({json:{id:jobId,status:'completed',stage:'completed',targetLanguage:'fr',sourceLanguage:'en',audioUrl:'http://localhost:3000/fake.ogg',error:null,createdAt:new Date().toISOString()}}));
  const header = Buffer.alloc(47); header.write('OggS', 0); header[5] = 2; header[26] = 1; header[27] = 19; header.write('OpusHead', 28); header[36] = 1; header[37] = 1;
  await page.route('**/fake.ogg', route => route.fulfill({status:200,body:header}));
  let downloaded = false; page.on('download', () => { downloaded = true; });
  await page.goto('/'); await signIn(page); await page.getByRole('button',{name:'Start recording'}).click(); await page.waitForTimeout(1300); await page.getByRole('button',{name:'Stop recording'}).click();
  await page.getByLabel('Translate into').selectOption('fr'); await page.getByLabel("I confirm this is my voice, or I have the speaker's permission to reproduce it.").check();
  await page.getByRole('button',{name:'Translate voice note'}).click(); const share = page.getByRole('button',{name:'Share with an app'}).first(); await expect(share).toBeEnabled({timeout:15000}); await share.click();
  await expect(page.getByRole('status').filter({hasText:'This browser cannot share audio directly'})).toBeVisible();
  expect(downloaded).toBe(false);
});

test('connections shows truthful sharing options and returns to the studio', async ({page}) => {
  await setup(page); await page.goto('/');
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button',{name:'Connections'}).click();
  await expect(page.getByRole('heading',{name:'Connections'})).toBeVisible();
  await expect(page.getByText('Direct account connections are not available yet.',{exact:false})).toBeVisible();
  await expect(page.getByText('Manual share',{exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'Go to voice studio'}).click();
  await expect(page.getByRole('heading',{name:'Your voice note',exact:true})).toBeVisible();
});

test('owner can review risk, pair and confirm one direct voice send', async ({page}) => {
  await setup(page); let phase='disconnected'; let sendCount=0; let pairingRead=0;
  await page.route('**/v1/personal-whatsapp/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/').pop();
    if(path==='status') return route.fulfill({json:{status:phase}});
    if(path==='connect') { phase='awaiting_confirmation'; return route.fulfill({status:202,json:{status:phase}}); }
    if(path==='pairing-code') {pairingRead++; return route.fulfill({json:{code:'ABCD1234'}});}
    if(path==='send') {const data=route.request().postDataJSON(); expect(data.previewConfirmed).toBe(true); expect(data.recipientConsented).toBe(true); expect(data.recipient).toBe('+2348001234567'); sendCount++; return route.fulfill({json:sendCount===1?{status:'unknown'}:{status:'accepted',messageId:'test'}});}
    if(path==='disconnect') {phase='disconnected';return route.fulfill({json:{status:phase}});}
    return route.fulfill({status:404});
  });
  await page.route('**/v1/voice/translate',route=>route.fulfill({status:202,json:{id:jobId}}));
  await page.route(`**/v1/voice/translations/${jobId}`,route=>route.fulfill({json:{id:jobId,status:'completed',stage:'completed',targetLanguage:'fr',sourceLanguage:'en',audioUrl:'http://localhost:3000/fake.ogg',error:null,createdAt:new Date().toISOString()}}));
  const header=Buffer.alloc(47);header.write('OggS',0);header[5]=2;header[26]=1;header[27]=19;header.write('OpusHead',28);header[36]=1;header[37]=1;
  await page.route('**/fake.ogg',route=>route.fulfill({status:200,body:header}));
  await page.goto('/');await signIn(page);await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Connections'}).click();
  await expect(page.getByRole('heading',{name:'Personal WhatsApp connection'})).toBeVisible();
  await page.getByLabel('Your WhatsApp number, including country code').fill('+2348001234567');
  await expect(page.getByRole('button',{name:'Link WhatsApp'})).toBeDisabled();
  await page.getByLabel('I understand the risk and want to link my account.').check(); await page.getByRole('button',{name:'Link WhatsApp'}).click();
  await expect(page.getByText('ABCD1234')).toBeVisible(); expect(pairingRead).toBe(1);
  phase='connected'; await expect(page.getByText('Connected. Select a completed note to send it.')).toBeVisible({timeout:8000});
  await page.getByRole('button',{name:'Go to voice studio'}).click();
  await page.getByRole('button',{name:'Start recording'}).click();await page.waitForTimeout(1300);await page.getByRole('button',{name:'Stop recording'}).click();
  await page.getByLabel('Translate into').selectOption('fr');await page.getByLabel("I confirm this is my voice, or I have the speaker's permission to reproduce it.").check();await page.getByRole('button',{name:'Translate voice note'}).click();
  await expect(page.getByRole('heading',{name:'Send through linked WhatsApp'})).toBeVisible({timeout:15000});
  await page.getByLabel('Recipient phone number').fill('+2348001234567');await expect(page.getByRole('button',{name:'Confirm and send'})).toBeDisabled();
  await page.getByLabel('I listened to this translation.').check();await page.getByLabel('The recipient agreed to receive this message.').check();await page.getByRole('button',{name:'Confirm and send'}).click();
  await expect(page.getByText('Send status is unknown.',{exact:false})).toBeVisible(); expect(sendCount).toBe(1);
  await expect(page.getByRole('button',{name:'Confirm and send'})).toBeDisabled();
  await page.getByLabel('I checked WhatsApp and understand that sending again may create a duplicate.').check();
  await page.getByRole('button',{name:'Confirm and send'}).click();
  await expect(page.getByText('WhatsApp accepted the voice note.',{exact:false})).toBeVisible();expect(sendCount).toBe(2);
});

test('mobile account tab opens profile and signed-in user can sign out', async ({browser}) => {
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await setup(page); await page.goto('/'); await signIn(page);
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'My account'})).toBeVisible();
  await expect(page.locator('.account-profile')).toContainText(user.email);
  await expect(page.getByText('Your translated voice notes will appear here.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:false}).first()).toBeVisible(); await page.close();
});
