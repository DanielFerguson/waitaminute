// Background service worker for WaitAMinute extension

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
    // Set default settings if not already set
    const result = await chrome.storage.sync.get(['settings', 'blockedDomains']);
    
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
    
    if (!result.blockedDomains) {
        await chrome.storage.sync.set({
            blockedDomains: []
        });
    }
    
    // Initialize statistics
    const stats = await chrome.storage.local.get(['statistics']);
    if (!stats.statistics) {
        await chrome.storage.local.set({
            statistics: {
                totalChallenges: 0,
                completedChallenges: 0,
                blockedVisits: 0,
                domainStats: {}
            }
        });
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

// Track challenge completion for statistics
async function trackChallengeCompletion(domain) {
    const result = await chrome.storage.local.get(['statistics']);
    const stats = result.statistics || {
        totalChallenges: 0,
        completedChallenges: 0,
        blockedVisits: 0,
        domainStats: {}
    };
    
    // Update overall stats
    stats.completedChallenges++;
    
    // Update domain-specific stats
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
}

// Get statistics
async function getStatistics() {
    const result = await chrome.storage.local.get(['statistics']);
    return result.statistics || {
        totalChallenges: 0,
        completedChallenges: 0,
        blockedVisits: 0,
        domainStats: {}
    };
}

// Track page visits to blocked domains
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Only track main frame navigations
    if (details.frameId !== 0) return;
    
    const result = await chrome.storage.sync.get(['blockedDomains', 'settings']);
    const blockedDomains = result.blockedDomains || [];
    const settings = result.settings || { enabled: true };
    
    if (!settings.enabled) return;
    
    // Parse URL
    const url = new URL(details.url);
    const hostname = url.hostname.replace(/^www\./, '');
    
    // Check if domain is blocked
    const isBlocked = blockedDomains.some(domain => {
        return hostname === domain || hostname.endsWith('.' + domain);
    });
    
    if (isBlocked) {
        // Track blocked visit
        const statsResult = await chrome.storage.local.get(['statistics']);
        const stats = statsResult.statistics || {
            totalChallenges: 0,
            completedChallenges: 0,
            blockedVisits: 0,
            domainStats: {}
        };
        
        stats.blockedVisits++;
        stats.totalChallenges++;
        
        if (!stats.domainStats[hostname]) {
            stats.domainStats[hostname] = {
                challenges: 0,
                completed: 0,
                lastCompleted: null
            };
        }
        
        stats.domainStats[hostname].challenges++;
        
        await chrome.storage.local.set({ statistics: stats });
    }
});

// Optional: Clear old bypass data periodically (every hour)
setInterval(async () => {
    // This could be implemented to clear bypass data from content scripts
    // For now, bypass data is managed in content script memory
    console.log('Periodic cleanup check');
}, 3600000); // 1 hour