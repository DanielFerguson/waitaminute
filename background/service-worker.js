importScripts('../shared/rules.js');

const { normaliseHostname, normaliseSettings, validateRules, domainMatches, localDateKey, recentDateKeys } = WaitAMinuteRules;
const STATS_DAYS = 14;
const COUNTERS = { blocked: ['blockedAttempts', 'attempts'], completed: ['challengesCompleted', 'completed'] };

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    // 1.1 intentionally starts from one canonical, clean configuration model.
    if (reason === 'update') await chrome.storage.sync.remove(['blockedDomains', 'blockedDomainsV2']);
    const { settings, rules } = await chrome.storage.sync.get(['settings', 'rules']);
    await chrome.storage.sync.set({ settings: normaliseSettings(settings), rules: validateRules(rules) || [] });
    await updateLocal('statistics', recentStats);
});

// Bypasses live in local storage so content scripts can read them without waking this worker;
// clearing them at startup keeps them limited to one browser session.
chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove('bypasses'));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const respond = (promise) => { promise.then(sendResponse, (error) => sendResponse({ error: error.message })); return true; };
    switch (request.action) {
        case 'createBypass': return respond(createBypass(request.domain, request.minutes));
        case 'createHardBlock': return respond(createHardBlock(request.target, request.domain));
        case 'getHardBlock': return respond(getHardBlock(request.nonce));
        case 'blockedAttempt': return respond(record(request.domain, 'blocked'));
        case 'challengeCompleted': return respond(record(request.domain, 'completed'));
        case 'resetStatistics': return respond(updateLocal('statistics', () => ({ dailyStats: {} })));
        case 'closeTab': if (sender.tab) chrome.tabs.remove(sender.tab.id); break;
    }
});

// Serialise read-modify-write updates so messages from several tabs can't overwrite each other.
let queue = Promise.resolve();
function updateLocal(key, change) {
    const run = queue.then(async () => {
        const current = (await chrome.storage.local.get(key))[key];
        await chrome.storage.local.set({ [key]: change(current) });
    });
    queue = run.catch(() => {});
    return run;
}

function createBypass(domain, minutes) {
    const now = Date.now();
    const expiresAt = now + normaliseSettings({ bypassDuration: minutes }).bypassDuration * 60000;
    return updateLocal('bypasses', (bypasses = {}) => ({
        ...Object.fromEntries(Object.entries(bypasses).filter(([, time]) => time > now)),
        [normaliseHostname(domain)]: expiresAt
    }));
}

async function createHardBlock(target, domain) {
    const url = new URL(target);
    if (!/^https?:$/.test(url.protocol) || !domainMatches(url.hostname, domain)) throw new Error('Invalid hard block target');
    const nonce = crypto.randomUUID();
    await chrome.storage.session.set({ [`hardBlock:${nonce}`]: { target: url.href, domain } });
    record(domain, 'blocked');
    return { url: chrome.runtime.getURL(`block/block.html?nonce=${encodeURIComponent(nonce)}`) };
}

async function getHardBlock(nonce) {
    const key = `hardBlock:${nonce}`;
    const value = (await chrome.storage.session.get(key))[key];
    return value ? { active: true, target: value.target, domain: value.domain } : { active: false };
}

function recentStats(value) {
    const dailyStats = value?.dailyStats || {};
    const keys = recentDateKeys(STATS_DAYS).filter((key) => dailyStats[key]);
    return { dailyStats: Object.fromEntries(keys.map((key) => [key, dailyStats[key]])) };
}

function record(domain, type) {
    const [dayCounter, domainCounter] = COUNTERS[type];
    return updateLocal('statistics', (value) => {
        const stats = recentStats(value);
        const day = stats.dailyStats[localDateKey()] ||= { blockedAttempts: 0, challengesCompleted: 0, domains: {} };
        const entry = day.domains[normaliseHostname(domain)] ||= { attempts: 0, completed: 0 };
        day[dayCounter]++;
        entry[domainCounter]++;
        return stats;
    });
}
