const { test, expect } = require('@playwright/test');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

let context, extensionId, server, baseUrl;
test.beforeAll(async () => {
    server = http.createServer((_, response) => response.end('<!doctype html><title>Test target</title><h1>Target</h1>'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext('', { headless: false, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: [`--disable-extensions-except=${path.resolve('.')}`, `--load-extension=${path.resolve('.')}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;
});
test.afterAll(async () => { await context?.close(); await new Promise((resolve) => server?.close(resolve)); });
async function popup() { const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/popup/popup.html`); return page; }
async function configure(page, rules, settings = {}) {
    await page.evaluate(async ({ rules, settings }) => {
        await chrome.storage.local.set({ onboardingAcknowledged: true });
        await chrome.storage.sync.set({ rules, settings: { enabled: true, challengeType: 'math', waitDuration: 5, bypassDuration: 1, ...settings } });
    }, { rules, settings });
    await page.reload();
}

test('onboarding is explicit and rules can be edited', async () => {
    const page = await popup();
    await page.evaluate(() => chrome.storage.local.remove('onboardingAcknowledged'));
    await page.reload();
    await expect(page.getByText('Before you begin')).toBeVisible();
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.getByLabel('Domain to block').fill('example.com');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.rule strong', { hasText: 'example.com' })).toBeVisible();
    await page.close();
});

test('soft blocks render a maths challenge in a closed Shadow DOM', async () => {
    const page = await popup(); await configure(page, [{ domain: '127.0.0.1', blockType: 'soft', timeSlots: [] }]); await page.close();
    const target = await context.newPage(); await target.goto(baseUrl);
    const shadowText = await target.locator('#waitaminute-extension-root').evaluate((host) => host.shadowRoot === null ? 'closed' : 'open');
    expect(shadowText).toBe('closed');
    await expect(target.locator('#waitaminute-extension-root')).toBeAttached();
    await target.close();
});

test('countdown alternative completes a maths challenge and creates a session bypass', async () => {
    const page = await popup();
    await configure(page, [{ domain: '127.0.0.1', blockType: 'soft', timeSlots: [] }], { challengeType: 'countdown', waitDuration: 300 });
    await page.evaluate(() => chrome.storage.session.remove('bypass:127.0.0.1'));
    await page.close();

    const target = await context.newPage();
    await target.goto(baseUrl);
    const overlay = target.locator('#waitaminute-extension-root');
    await expect(overlay).toBeAttached();

    // The alternative button and then the maths input receive focus inside the closed Shadow DOM.
    await target.keyboard.press('Enter');
    for (let answer = 2; answer <= 20 && await overlay.count(); answer++) {
        await target.keyboard.type(String(answer));
        await target.keyboard.press('Enter');
    }

    await expect(overlay).not.toBeAttached();
    const verificationPage = await popup();
    await expect.poll(async () => {
        const bypass = await verificationPage.evaluate(() => chrome.storage.session.get('bypass:127.0.0.1'));
        return Number(bypass['bypass:127.0.0.1']);
    }).toBeGreaterThan(Date.now());
    await verificationPage.close();
    await target.close();
});

test('hard blocks navigate to an extension-owned page without the target URL', async () => {
    const page = await popup(); await configure(page, [{ domain: '127.0.0.1', blockType: 'hard', timeSlots: [] }]); await page.close();
    const target = await context.newPage(); await target.goto(baseUrl);
    await expect(target.getByRole('heading', { name: 'Access blocked' })).toBeVisible();
    expect(target.url()).toContain(`chrome-extension://${extensionId}/block/block.html?nonce=`);
    expect(target.url()).not.toContain('127.0.0.1');
    await target.close();
});

test('import rejects invalid files without changing configuration', async () => {
    const page = await popup(); await configure(page, [{ domain: 'example.com', blockType: 'soft', timeSlots: [] }]);
    await page.setInputFiles('#importConfig', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') });
    await expect(page.getByText('That is not a valid WaitAMinute settings file.')).toBeVisible();
    await expect(page.getByText('example.com')).toBeVisible(); await page.close();
});
