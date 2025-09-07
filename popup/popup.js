// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await loadDomains();
    await loadSettings();
    setupEventListeners();
});

// Load blocked domains from storage
async function loadDomains() {
    const result = await chrome.storage.sync.get(['blockedDomains']);
    const domains = result.blockedDomains || [];
    renderDomains(domains);
}

// Load settings from storage
async function loadSettings() {
    const result = await chrome.storage.sync.get(['settings']);
    const settings = result.settings || {
        enabled: true,
        challengeType: 'countdown',
        turnstileKey: '',
        waitDuration: 30,
        bypassDuration: 10
    };
    
    document.getElementById('enableToggle').checked = settings.enabled;
    document.getElementById('challengeType').value = settings.challengeType;
    document.getElementById('turnstileKey').value = settings.turnstileKey || '';
    document.getElementById('waitDuration').value = settings.waitDuration || 30;
    document.getElementById('bypassDuration').value = settings.bypassDuration;
    
    // Show/hide sections based on challenge type
    toggleChallengeSettings(settings.challengeType);
}

// Render domains in the list
function renderDomains(domains) {
    const domainList = document.getElementById('domainList');
    
    if (domains.length === 0) {
        domainList.innerHTML = '<div class="empty-state">No blocked domains yet</div>';
        return;
    }
    
    domainList.innerHTML = domains.map(domain => `
        <div class="domain-item" data-domain="${domain}">
            <span class="domain-name">${domain}</span>
            <button class="remove-btn" data-domain="${domain}">×</button>
        </div>
    `).join('');
}

// Setup event listeners
function setupEventListeners() {
    // Add domain
    document.getElementById('addButton').addEventListener('click', addDomain);
    document.getElementById('domainInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addDomain();
    });
    
    // Remove domain (delegate to parent)
    document.getElementById('domainList').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
            removeDomain(e.target.dataset.domain);
        }
    });
    
    // Enable/disable toggle
    document.getElementById('enableToggle').addEventListener('change', async (e) => {
        await updateSettings({ enabled: e.target.checked });
    });
    
    // Challenge type change
    document.getElementById('challengeType').addEventListener('change', async (e) => {
        toggleChallengeSettings(e.target.value);
        await updateSettings({ challengeType: e.target.value });
    });
    
    // Wait duration change
    document.getElementById('waitDuration').addEventListener('change', async (e) => {
        await updateSettings({ waitDuration: parseInt(e.target.value) });
    });
    
    // Turnstile key change
    document.getElementById('turnstileKey').addEventListener('blur', async (e) => {
        await updateSettings({ turnstileKey: e.target.value });
    });
    
    // Bypass duration change
    document.getElementById('bypassDuration').addEventListener('change', async (e) => {
        await updateSettings({ bypassDuration: parseInt(e.target.value) });
    });
    
    // Statistics link
    document.getElementById('statsLink').addEventListener('click', (e) => {
        e.preventDefault();
        // TODO: Implement statistics view
        alert('Statistics feature coming soon!');
    });
}

// Add a new domain to the block list
async function addDomain() {
    const input = document.getElementById('domainInput');
    let domain = input.value.trim().toLowerCase();
    
    if (!domain) return;
    
    // Remove protocol if present
    domain = domain.replace(/^https?:\/\//, '');
    // Remove www if present
    domain = domain.replace(/^www\./, '');
    // Remove trailing slash
    domain = domain.replace(/\/$/, '');
    
    // Validate domain format
    if (!isValidDomain(domain)) {
        alert('Please enter a valid domain (e.g., example.com)');
        return;
    }
    
    // Get current domains
    const result = await chrome.storage.sync.get(['blockedDomains']);
    const domains = result.blockedDomains || [];
    
    // Check if already exists
    if (domains.includes(domain)) {
        alert('This domain is already in your block list');
        return;
    }
    
    // Add and save
    domains.push(domain);
    await chrome.storage.sync.set({ blockedDomains: domains });
    
    // Update UI
    renderDomains(domains);
    input.value = '';
    
    // Notify background script
    chrome.runtime.sendMessage({ action: 'domainsUpdated', domains });
}

// Remove a domain from the block list
async function removeDomain(domain) {
    const result = await chrome.storage.sync.get(['blockedDomains']);
    let domains = result.blockedDomains || [];
    
    domains = domains.filter(d => d !== domain);
    await chrome.storage.sync.set({ blockedDomains: domains });
    
    renderDomains(domains);
    
    // Notify background script
    chrome.runtime.sendMessage({ action: 'domainsUpdated', domains });
}

// Update settings
async function updateSettings(updates) {
    const result = await chrome.storage.sync.get(['settings']);
    const settings = result.settings || {
        enabled: true,
        challengeType: 'countdown',
        turnstileKey: '',
        waitDuration: 30,
        bypassDuration: 10
    };
    
    const newSettings = { ...settings, ...updates };
    await chrome.storage.sync.set({ settings: newSettings });
    
    // Notify background script
    chrome.runtime.sendMessage({ action: 'settingsUpdated', settings: newSettings });
}

// Toggle challenge-specific settings visibility
function toggleChallengeSettings(challengeType) {
    const turnstileSection = document.getElementById('turnstileKeySection');
    const waitSection = document.getElementById('waitDurationSection');
    
    // Hide all sections first
    turnstileSection.style.display = 'none';
    waitSection.style.display = 'none';
    
    // Show relevant section
    if (challengeType === 'turnstile') {
        turnstileSection.style.display = 'flex';
    } else if (challengeType === 'countdown') {
        waitSection.style.display = 'flex';
    }
}

// Validate domain format
function isValidDomain(domain) {
    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
    return domainRegex.test(domain);
}