const { test, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const http = require('node:http');

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
        await chrome.storage.local.remove('bypasses');
        await chrome.storage.sync.set({ rules, settings: { enabled: true, challengeType: 'math', waitDuration: 5, bypassDuration: 1, ...settings } });
    }, { rules, settings });
    await page.reload();
}
const softBlock = [{ domain: '127.0.0.1', blockType: 'soft', timeSlots: [] }];

test('onboarding is explicit and rules can be edited', async () => {
    const page = await popup();
    await page.evaluate(() => chrome.storage.local.remove('onboardingAcknowledged'));
    await page.reload();
    await expect(page.getByText('Before you begin')).toBeVisible();
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.getByLabel('Domain to block').fill('example.com');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.rule strong', { hasText: 'example.com' })).toBeVisible();
    await page.close();
});

test('cancelling a new domain leaves no hidden rule behind', async () => {
    const page = await popup(); await configure(page, []);
    await page.getByLabel('Domain to block').fill('https://www.cancelled.example/path');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('#modalDomain')).toHaveText('cancelled.example');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('#ruleDialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => chrome.storage.sync.get('rules'))).toEqual({ rules: [] });
    await page.close();
});

test('saved preset schedules are recognised after a round trip through storage', async () => {
    const page = await popup();
    await configure(page, [{ domain: 'example.com', blockType: 'soft', timeSlots: [{ startTime: '09:00', endTime: '17:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }] }]);
    await expect(page.locator('.rule p')).toHaveText('Soft block · Weekdays, 9am–5pm');
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#scheduleMode')).toHaveValue('weekday');
    await page.close();
});

test('the wait duration is only shown for countdowns', async () => {
    const page = await popup(); await configure(page, [], { challengeType: 'countdown' });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByLabel('Wait seconds')).toBeVisible();
    await page.locator('#challengeType').selectOption('math');
    await expect(page.getByLabel('Wait seconds')).toBeHidden();
    await page.close();
});

test('soft blocks render a maths challenge in a closed Shadow DOM', async () => {
    const page = await popup(); await configure(page, softBlock); await page.close();
    const target = await context.newPage(); await target.goto(baseUrl);
    const shadowText = await target.locator('#waitaminute-extension-root').evaluate((host) => host.shadowRoot === null ? 'closed' : 'open');
    expect(shadowText).toBe('closed');
    await expect(target.locator('#waitaminute-extension-root')).toBeAttached();
    await target.close();
});

test('countdown alternative completes a maths challenge and creates a session bypass', async () => {
    const page = await popup();
    await configure(page, softBlock, { challengeType: 'countdown', waitDuration: 300 });
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
        const { bypasses } = await verificationPage.evaluate(() => chrome.storage.local.get('bypasses'));
        return Number(bypasses?.['127.0.0.1']);
    }).toBeGreaterThan(Date.now());
    await verificationPage.close();
    await target.close();
});

test('the soft-block exit button returns to the previous page', async () => {
    const page = await popup(); await configure(page, softBlock, { challengeType: 'countdown', waitDuration: 300 }); await page.close();
    const target = await context.newPage();
    await target.goto(baseUrl.replace('127.0.0.1', 'localhost'));
    await target.goto(baseUrl);
    await expect(target.locator('#waitaminute-extension-root')).toBeAttached();
    await target.keyboard.press('Tab'); // From the maths alternative to "Go back".
    await target.keyboard.press('Enter');
    await expect(target).toHaveURL(/localhost/);
    await target.close();
});

test('the soft-block exit button closes a tab with no history', async () => {
    const page = await popup(); await configure(page, softBlock, { challengeType: 'countdown', waitDuration: 300 }); await page.close();
    // A tab opened from a link starts without history (unlike Playwright's newPage, which keeps about:blank).
    const opener = await context.newPage();
    await opener.goto(baseUrl.replace('127.0.0.1', 'localhost'));
    const [target] = await Promise.all([context.waitForEvent('page'), opener.evaluate((url) => { window.open(url); }, baseUrl)]);
    await expect(target.locator('#waitaminute-extension-root')).toBeAttached();
    await target.bringToFront();
    const closed = target.waitForEvent('close');
    await target.keyboard.press('Tab'); // From the maths alternative to "Close tab".
    await target.keyboard.press('Enter');
    await closed;
    await opener.close();
});

test('hard blocks navigate to an extension-owned page without the target URL and are counted', async () => {
    const page = await popup();
    await configure(page, [{ domain: '127.0.0.1', blockType: 'hard', timeSlots: [] }]);
    await page.evaluate(() => chrome.storage.local.set({ statistics: { dailyStats: {} } }));
    const target = await context.newPage(); await target.goto(baseUrl, { waitUntil: 'commit' });
    await expect(target.getByRole('heading', { name: 'Access blocked' })).toBeVisible();
    expect(target.url()).toContain(`chrome-extension://${extensionId}/block/block.html?nonce=`);
    expect(target.url()).not.toContain('127.0.0.1');
    await expect.poll(async () => {
        const { statistics } = await page.evaluate(() => chrome.storage.local.get('statistics'));
        return Object.values(statistics.dailyStats)[0]?.domains['127.0.0.1']?.attempts;
    }).toBe(1);
    await target.close();
    await page.close();
});

test('export produces a configuration file', async () => {
    const rules = [{ domain: 'example.com', blockType: 'hard', timeSlots: [] }];
    const page = await popup(); await configure(page, rules);
    await page.getByRole('tab', { name: 'Settings' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export settings' }).click()]);
    const config = JSON.parse(await require('node:fs/promises').readFile(await download.path(), 'utf8'));
    expect(config).toMatchObject({ format: 'waitaminute-config', version: 1, rules });
    await page.close();
});

test('import rejects invalid files without changing configuration', async () => {
    const page = await popup(); await configure(page, [{ domain: 'example.com', blockType: 'soft', timeSlots: [] }]);
    await page.setInputFiles('#importConfig', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') });
    await expect(page.getByText('That is not a valid WaitAMinute settings file.')).toBeVisible();
    await expect(page.getByText('example.com')).toBeVisible(); await page.close();
});
