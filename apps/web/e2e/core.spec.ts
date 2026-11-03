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
  await dialog.getByLabel('Email address').fill(user.email); await dialog.getByLabel('Password', { exact: true }).fill('password123'); await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Check your email');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByLabel('Password', { exact: true }).fill('password123'); await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();
  await page.reload(); await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();
  await page.getByRole('button', { name: /Sign out/ }).click(); await expect(page.getByRole('button', { name: 'Sign in', exact: false }).first()).toBeVisible();
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

test('invalid credentials surface an error and do not sign in', async ({page}) => {
  await setup(page); await page.route('https://example.supabase.co/auth/v1/token**', route => route.fulfill({status:400,json:{error:'invalid_grant',error_description:'Invalid login credentials'}}));
  await page.goto('/'); await page.getByRole('button',{name:'Sign in',exact:false}).first().click();
  const dialog=page.getByRole('dialog'); await dialog.getByLabel('Email address').fill(user.email); await dialog.getByLabel('Password',{exact:true}).fill('incorrect'); await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('Invalid login credentials'); await expect(dialog).toBeVisible();
});

test('document head exposes consistent crawlable branding and social previews', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('VoiceBridge AI — Different language. Same you.');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://voicebridge-9unm.onrender.com/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'VoiceBridge AI — Different language. Same you.');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://voicebridge-9unm.onrender.com/og-image.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', 'https://voicebridge-9unm.onrender.com/og-image.png');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  const preview = await page.request.get('http://127.0.0.1:3000/og-image.png');
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
  expect(documentHtml).toContain('VoiceBridge AI');
});


test('mobile layout uses compact navigation and keeps content within the viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav).toBeVisible();
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
