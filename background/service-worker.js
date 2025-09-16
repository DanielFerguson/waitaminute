// Background service worker for WaitAMinute extension

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
    // Set default settings if not already set
    const result = await chrome.storage.sync.get(['settings', 'blockedDomains', 'blockedDomainsV2']);

    if (!result.settings) {
        await chrome.storage.sync.set({
            settings: {
                enabled: true,
                challengeType: 'math',
                turnstileKey: '',
                bypassDuration: 10
            }
        });
    }

    // Migrate old blockedDomains to new format if needed
    if (result.blockedDomains && !result.blockedDomainsV2) {
        const migratedDomains = result.blockedDomains.map(domain => ({
            domain: domain,
            timeSlots: [],
            alwaysBlock: true,
            blockType: 'soft'
        }));
        await chrome.storage.sync.set({ blockedDomainsV2: migratedDomains });
    } else if (!result.blockedDomainsV2) {
        await chrome.storage.sync.set({
            blockedDomainsV2: []
        });
    }
    
    // Initialize statistics
    const stats = await chrome.storage.local.get(['statistics']);
    if (!stats.statistics) {
        await chrome.storage.local.set({
            statistics: {
                // New daily-based format
                dailyStats: {},
                // Legacy format for migration
                totalChallenges: 0,
                completedChallenges: 0,
                blockedVisits: 0,
                domainStats: {}
            }
        });
    } else if (!stats.statistics.dailyStats) {
        // Migrate existing stats to daily format
        await migrateStatistics();
    }
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'domainsUpdated':
            handleDomainsUpdate(request.domains);
            break;
            
        case 'settingsUpdated':
            handleSettingsUpdate(request.settings);
            break;
            
        case 'challengeCompleted':
            trackChallengeCompletion(request.domain);
            break;
            
        case 'getStatistics':
            getStatistics().then(stats => sendResponse(stats));
            return true; // Keep channel open for async response

        case 'resetStatistics':
            resetStatistics().then(() => sendResponse({ success: true }));
            return true; // Keep channel open for async response

        default:
            break;
    }
});

// Handle domains update
function handleDomainsUpdate(domains) {
    // Domains are already saved by popup, just log for debugging
    console.log('Blocked domains updated:', domains);
}

// Handle settings update
function handleSettingsUpdate(settings) {
    // Settings are already saved by popup, just log for debugging
    console.log('Settings updated:', settings);
}

// Get today's date string in YYYY-MM-DD format
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

// Migrate old statistics to daily format
async function migrateStatistics() {
    const result = await chrome.storage.local.get(['statistics']);
    const oldStats = result.statistics || {};

    const today = getTodayDateString();
    const newStats = {
        dailyStats: {
            [today]: {
                blockedAttempts: oldStats.totalChallenges || 0,
                challengesCompleted: oldStats.completedChallenges || 0,
                domains: {}
            }
        },
        // Keep legacy stats for reference
        totalChallenges: oldStats.totalChallenges || 0,
        completedChallenges: oldStats.completedChallenges || 0,
        blockedVisits: oldStats.blockedVisits || 0,
        domainStats: oldStats.domainStats || {}
    };

    // Migrate domain stats to today's entry
    if (oldStats.domainStats) {
        for (const [domain, domainData] of Object.entries(oldStats.domainStats)) {
            newStats.dailyStats[today].domains[domain] = {
                attempts: domainData.challenges || 0,
                completed: domainData.completed || 0
            };
        }
    }

    await chrome.storage.local.set({ statistics: newStats });
}

// Initialize today's stats if they don't exist
async function ensureTodayStats() {
    const today = getTodayDateString();
    const result = await chrome.storage.local.get(['statistics']);
    const stats = result.statistics || {
        dailyStats: {},
        totalChallenges: 0,
        completedChallenges: 0,
        blockedVisits: 0,
        domainStats: {}
    };

    if (!stats.dailyStats) {
        stats.dailyStats = {};
    }

    if (!stats.dailyStats[today]) {
        stats.dailyStats[today] = {
            blockedAttempts: 0,
            challengesCompleted: 0,
            domains: {}
        };
        await chrome.storage.local.set({ statistics: stats });
    }

    return stats;
}

// Track challenge completion for statistics
async function trackChallengeCompletion(domain) {
    console.log('WaitAMinute: Tracking challenge completion for:', domain);
    const stats = await ensureTodayStats();
    const today = getTodayDateString();

    // Update today's stats
    stats.dailyStats[today].challengesCompleted++;
    console.log('WaitAMinute: Updated challenges completed to:', stats.dailyStats[today].challengesCompleted);

    // Update domain-specific stats for today
    if (!stats.dailyStats[today].domains[domain]) {
        stats.dailyStats[today].domains[domain] = {
            attempts: 0,
            completed: 0
        };
    }

    stats.dailyStats[today].domains[domain].completed++;
    console.log('WaitAMinute: Domain', domain, 'completed challenges:', stats.dailyStats[today].domains[domain].completed);

    // Update legacy stats for backward compatibility
    stats.completedChallenges = (stats.completedChallenges || 0) + 1;
    if (!stats.domainStats) stats.domainStats = {};
    if (!stats.domainStats[domain]) {
        stats.domainStats[domain] = {
            challenges: 0,
            completed: 0,
            lastCompleted: null
        };
    }
    stats.domainStats[domain].completed++;
    stats.domainStats[domain].lastCompleted = new Date().toISOString();

    await chrome.storage.local.set({ statistics: stats });
    console.log('WaitAMinute: Statistics saved to storage');
}

// Get statistics
async function getStatistics() {
    const result = await chrome.storage.local.get(['statistics']);
    return result.statistics || {
        dailyStats: {},
        totalChallenges: 0,
        completedChallenges: 0,
        blockedVisits: 0,
        domainStats: {}
    };
}

// Reset all statistics
async function resetStatistics() {
    const newStats = {
        dailyStats: {},
        totalChallenges: 0,
        completedChallenges: 0,
        blockedVisits: 0,
        domainStats: {}
    };
    await chrome.storage.local.set({ statistics: newStats });
    console.log('WaitAMinute: All statistics have been reset');
}

// Track page visits to blocked domains
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only track main frame navigations
    if (details.frameId !== 0) return;

    const result = await chrome.storage.sync.get(['blockedDomainsV2', 'settings']);
    const blockedDomainsV2 = result.blockedDomainsV2 || [];
    const settings = result.settings || { enabled: true };

    if (!settings.enabled) return;

    // Parse URL
    const url = new URL(details.url);
    const hostname = url.hostname.replace(/^www\./, '');

    // Check if domain is blocked using V2 format
    const isBlocked = blockedDomainsV2.some(domainItem => {
        return hostname === domainItem.domain || hostname.endsWith('.' + domainItem.domain);
    });

    if (isBlocked) {
        console.log('WaitAMinute: Blocked navigation to:', hostname);
        // Track blocked visit using new daily format
        const stats = await ensureTodayStats();
        const today = getTodayDateString();

        // Update today's stats
        stats.dailyStats[today].blockedAttempts++;
        console.log('WaitAMinute: Updated blocked attempts to:', stats.dailyStats[today].blockedAttempts);

        // Update domain-specific stats for today
        if (!stats.dailyStats[today].domains[hostname]) {
            stats.dailyStats[today].domains[hostname] = {
                attempts: 0,
                completed: 0
            };
        }

        stats.dailyStats[today].domains[hostname].attempts++;
        console.log('WaitAMinute: Domain', hostname, 'blocked attempts:', stats.dailyStats[today].domains[hostname].attempts);

        // Update legacy stats for backward compatibility
        stats.blockedVisits = (stats.blockedVisits || 0) + 1;
        stats.totalChallenges = (stats.totalChallenges || 0) + 1;

        if (!stats.domainStats) stats.domainStats = {};
        if (!stats.domainStats[hostname]) {
            stats.domainStats[hostname] = {
                challenges: 0,
                completed: 0,
                lastCompleted: null
            };
        }

        stats.domainStats[hostname].challenges++;

        await chrome.storage.local.set({ statistics: stats });
        console.log('WaitAMinute: Navigation statistics saved');
    }
});

// Clean up old statistics data (keep only last 14 days)
async function cleanupOldStats() {
    const result = await chrome.storage.local.get(['statistics']);
    const stats = result.statistics;

    if (!stats || !stats.dailyStats) return;

    const today = new Date();
    const fourteenDaysAgo = new Date(today.getTime() - (14 * 24 * 60 * 60 * 1000));
    const cutoffDate = fourteenDaysAgo.toISOString().split('T')[0];

    let hasChanges = false;
    for (const dateKey of Object.keys(stats.dailyStats)) {
        if (dateKey < cutoffDate) {
            delete stats.dailyStats[dateKey];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        await chrome.storage.local.set({ statistics: stats });
        console.log('Cleaned up old statistics data');
    }
}

// Periodic cleanup (every hour)
setInterval(async () => {
    await cleanupOldStats();
    console.log('Periodic cleanup check completed');
}, 3600000); // 1 hour