importScripts('../shared/rules.js');

const DEFAULT_SETTINGS = { enabled: true, challengeType: 'countdown', waitDuration: 30, bypassDuration: 10 };
const STATS_EMPTY = () => ({ dailyStats: {}, totalChallenges: 0, completedChallenges: 0, blockedVisits: 0, domainStats: {} });
const CLEANUP_ALARM = 'waitaminute-cleanup-statistics';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    // 1.1 intentionally starts from one canonical, clean configuration model.
    if (reason === 'update') await chrome.storage.sync.remove(['blockedDomains', 'blockedDomainsV2']);
    const { settings, rules } = await chrome.storage.sync.get(['settings', 'rules']);
    await chrome.storage.sync.set({
        settings: normaliseSettings(settings),
        rules: WaitAMinuteRules.validateRules(rules) || []
    });
    if (!(await chrome.storage.local.get('statistics')).statistics) await chrome.storage.local.set({ statistics: STATS_EMPTY() });
    await ensureCleanupAlarm();
});

function normaliseSettings(value) {
    const settings = { ...DEFAULT_SETTINGS, ...(value || {}) };
    settings.enabled = Boolean(settings.enabled);
    settings.challengeType = settings.challengeType === 'math' ? 'math' : 'countdown';
    settings.waitDuration = Math.min(300, Math.max(5, Number(settings.waitDuration) || DEFAULT_SETTINGS.waitDuration));
    settings.bypassDuration = Math.min(60, Math.max(1, Number(settings.bypassDuration) || DEFAULT_SETTINGS.bypassDuration));
    return settings;
}

async function ensureCleanupAlarm() {
    if (!await chrome.alarms.get(CLEANUP_ALARM)) await chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 24 * 60 });
}
ensureCleanupAlarm();
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === CLEANUP_ALARM) cleanupOldStats(); });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const respond = (promise) => { promise.then(sendResponse).catch((error) => sendResponse({ error: error.message })); return true; };
    switch (request.action) {
        case 'getBypass': return respond(getBypass(request.domain));
        case 'createBypass': return respond(createBypass(request.domain, request.minutes));
        case 'createHardBlock': return respond(createHardBlock(request.target, request.domain));
        case 'getHardBlock': return respond(getHardBlock(request.nonce));
        case 'blockedAttempt': trackBlockedAttempt(request.domain); break;
        case 'challengeCompleted': trackChallengeCompletion(request.domain); break;
        case 'getStatistics': return respond(getStatistics());
        case 'resetStatistics': return respond(resetStatistics());
    }
});

async function getBypass(domain) {
    const key = `bypass:${WaitAMinuteRules.normaliseHostname(domain)}`;
    const value = (await chrome.storage.session.get(key))[key];
    if (Number(value) > Date.now()) return { active: true };
    if (value) await chrome.storage.session.remove(key);
    return { active: false };
}

async function createBypass(domain, minutes) {
    const duration = Math.min(60, Math.max(1, Number(minutes) || DEFAULT_SETTINGS.bypassDuration));
    await chrome.storage.session.set({ [`bypass:${WaitAMinuteRules.normaliseHostname(domain)}`]: Date.now() + duration * 60000 });
    return { success: true };
}

async function createHardBlock(target, domain) {
    const url = new URL(target);
    if (!/^https?:$/.test(url.protocol) || !WaitAMinuteRules.domainMatches(url.hostname, domain)) throw new Error('Invalid hard block target');
    const nonce = crypto.randomUUID();
    await chrome.storage.session.set({ [`hardBlock:${nonce}`]: { target: url.href, domain, createdAt: Date.now() } });
    return { url: chrome.runtime.getURL(`block/block.html?nonce=${encodeURIComponent(nonce)}`) };
}

async function getHardBlock(nonce) {
    const key = `hardBlock:${nonce}`;
    const value = (await chrome.storage.session.get(key))[key];
    if (!value || Date.now() - value.createdAt > 10 * 60 * 1000) return { active: false };
    return { active: true, target: value.target, domain: value.domain };
}

async function getMutableStats() {
    const stats = normaliseStats((await chrome.storage.local.get('statistics')).statistics);
    const today = WaitAMinuteRules.localDateKey();
    stats.dailyStats[today] ||= { blockedAttempts: 0, challengesCompleted: 0, domains: {} };
    return { stats, today };
}
function normaliseStats(value) { return { ...STATS_EMPTY(), ...(value || {}), dailyStats: value?.dailyStats || {}, domainStats: value?.domainStats || {} }; }
function domainStatsFor(stats, today, domain) {
    stats.dailyStats[today].domains[domain] ||= { attempts: 0, completed: 0 };
    stats.domainStats[domain] ||= { challenges: 0, completed: 0, lastCompleted: null };
}
async function trackBlockedAttempt(domain) {
    const { stats, today } = await getMutableStats(); domainStatsFor(stats, today, domain);
    stats.dailyStats[today].blockedAttempts++; stats.dailyStats[today].domains[domain].attempts++;
    stats.blockedVisits++; stats.totalChallenges++; stats.domainStats[domain].challenges++;
    await chrome.storage.local.set({ statistics: stats });
}
async function trackChallengeCompletion(domain) {
    const { stats, today } = await getMutableStats(); domainStatsFor(stats, today, domain);
    stats.dailyStats[today].challengesCompleted++; stats.dailyStats[today].domains[domain].completed++;
    stats.completedChallenges++; stats.domainStats[domain].completed++; stats.domainStats[domain].lastCompleted = new Date().toISOString();
    await chrome.storage.local.set({ statistics: stats });
}
async function getStatistics() { return normaliseStats((await chrome.storage.local.get('statistics')).statistics); }
async function resetStatistics() { await chrome.storage.local.set({ statistics: STATS_EMPTY() }); return { success: true }; }
async function cleanupOldStats() {
    const { stats } = await getMutableStats(); const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const cutoffKey = WaitAMinuteRules.localDateKey(cutoff);
    for (const key of Object.keys(stats.dailyStats)) if (key < cutoffKey) delete stats.dailyStats[key];
    await chrome.storage.local.set({ statistics: stats });
}
