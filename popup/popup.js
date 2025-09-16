// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await loadDomains();
    await loadSettings();
    setupEventListeners();
    setupTabNavigation();
    // Load statistics when the popup opens
    await loadStatistics();
});

// Store for domains data
let domainsData = [];
let currentEditDomain = null;

// Load blocked domains from storage
async function loadDomains() {
    const result = await chrome.storage.sync.get(['blockedDomainsV2', 'blockedDomains']);

    // Use V2 if available, otherwise migrate from old format
    if (result.blockedDomainsV2) {
        domainsData = result.blockedDomainsV2;
    } else if (result.blockedDomains) {
        // Migrate old format
        domainsData = result.blockedDomains.map(domain => ({
            domain: domain,
            timeSlots: [],
            alwaysBlock: true,
            blockType: 'soft'
        }));
        await chrome.storage.sync.set({ blockedDomainsV2: domainsData });
    } else {
        domainsData = [];
    }

    renderDomains();
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
function renderDomains() {
    const domainList = document.getElementById('domainList');

    if (domainsData.length === 0) {
        domainList.innerHTML = '<div class="empty-state">No blocked domains yet</div>';
        return;
    }

    domainList.innerHTML = domainsData.map(domainItem => {
        const timeInfo = getTimeSlotInfo(domainItem);
        const blockTypeIndicator = domainItem.blockType === 'hard' ?
            '<span class="block-indicator hard">HARD</span>' :
            '<span class="block-indicator soft">SOFT</span>';

        return `
            <div class="domain-item" data-domain="${domainItem.domain}">
                <div class="domain-info">
                    <div>
                        <span class="domain-name">${domainItem.domain}</span>
                        ${blockTypeIndicator}
                    </div>
                    ${timeInfo ? `<div class="domain-time-info">${timeInfo}</div>` : ''}
                </div>
                <button class="remove-btn" data-domain="${domainItem.domain}">×</button>
            </div>
        `;
    }).join('');
}

// Get time slot info for display
function getTimeSlotInfo(domainItem) {
    if (domainItem.alwaysBlock) {
        return 'Always blocked';
    }
    if (domainItem.timeSlots && domainItem.timeSlots.length > 0) {
        const count = domainItem.timeSlots.length;

        if (count === 1) {
            // Show the actual time slot for single slot
            const slot = domainItem.timeSlots[0];
            const startTime12hr = formatTimeTo12Hour(slot.startTime);
            const endTime12hr = formatTimeTo12Hour(slot.endTime);
            const days = slot.days.length === 7 ? 'Daily' :
                        slot.days.length === 5 && !slot.days.includes('Sat') && !slot.days.includes('Sun') ? 'Weekdays' :
                        slot.days.join(', ');
            return `${startTime12hr} - ${endTime12hr} (${days})`;
        } else {
            return `${count} time slots configured`;
        }
    }
    return 'No time restrictions';
}

// Helper function to format 24-hour time to 12-hour format
function formatTimeTo12Hour(time24) {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

// Setup event listeners
function setupEventListeners() {
    // Add domain
    document.getElementById('addButton').addEventListener('click', addDomain);
    document.getElementById('domainInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addDomain();
    });

    // Domain list clicks
    document.getElementById('domainList').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
            e.stopPropagation();
            removeDomain(e.target.dataset.domain);
        } else {
            // Click on domain item opens time slot configuration
            const domainItem = e.target.closest('.domain-item');
            if (domainItem) {
                openTimeSlotModal(domainItem.dataset.domain);
            }
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

    // Reset statistics button
    document.getElementById('resetStatistics').addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all statistics? This action cannot be undone.')) {
            await resetStatistics();
        }
    });

    // Modal controls
    document.querySelector('.close-modal').addEventListener('click', closeTimeSlotModal);
    document.getElementById('cancelTimeSlots').addEventListener('click', closeTimeSlotModal);
    document.getElementById('saveTimeSlots').addEventListener('click', saveTimeSlots);
    document.getElementById('addTimeSlot').addEventListener('click', addTimeSlot);
    document.getElementById('alwaysBlock').addEventListener('change', toggleTimeSlotConfig);

    // Close modal when clicking outside
    document.getElementById('timeSlotModal').addEventListener('click', (e) => {
        if (e.target.id === 'timeSlotModal') {
            closeTimeSlotModal();
        }
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

    // Check if already exists
    if (domainsData.some(d => d.domain === domain)) {
        alert('This domain is already in your block list');
        return;
    }

    // Add new domain with default settings
    const newDomain = {
        domain: domain,
        timeSlots: [],
        alwaysBlock: true,
        blockType: 'soft'
    };

    domainsData.push(newDomain);
    await saveDomains();

    // Update UI
    renderDomains();
    input.value = '';

    // Open time slot configuration for new domain
    openTimeSlotModal(domain);
}

// Remove a domain from the block list
async function removeDomain(domain) {
    if (!confirm(`Remove ${domain} from your block list?`)) {
        return;
    }

    domainsData = domainsData.filter(d => d.domain !== domain);
    await saveDomains();
    renderDomains();
}

// Open time slot configuration modal
function openTimeSlotModal(domain) {
    currentEditDomain = domainsData.find(d => d.domain === domain);
    if (!currentEditDomain) return;

    // Set modal content
    document.getElementById('modalDomain').textContent = domain;
    document.querySelector(`input[name="blockType"][value="${currentEditDomain.blockType}"]`).checked = true;
    document.getElementById('alwaysBlock').checked = currentEditDomain.alwaysBlock;

    // Render time slots
    renderTimeSlots();
    toggleTimeSlotConfig();

    // Show modal
    document.getElementById('timeSlotModal').style.display = 'block';
}

// Close time slot modal
function closeTimeSlotModal() {
    document.getElementById('timeSlotModal').style.display = 'none';
    currentEditDomain = null;
}

// Render time slots in modal
function renderTimeSlots() {
    const container = document.getElementById('timeSlotList');

    if (!currentEditDomain.timeSlots || currentEditDomain.timeSlots.length === 0) {
        container.innerHTML = '<div style="color: #999; padding: 10px;">No time slots configured</div>';
        return;
    }

    container.innerHTML = currentEditDomain.timeSlots.map((slot, index) => {
        const daysText = slot.days.length === 7 ? 'Every day' : slot.days.join(', ');

        return `
            <div class="time-slot-item" data-index="${index}">
                <div class="time-slot-times">
                    <input type="time" value="${slot.startTime}" data-field="startTime" data-index="${index}">
                    <span>to</span>
                    <input type="time" value="${slot.endTime}" data-field="endTime" data-index="${index}">
                </div>
                <div class="days-selector">
                    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `
                        <label class="day-checkbox ${slot.days.includes(day) ? 'checked' : ''}">
                            <input type="checkbox" value="${day}" data-index="${index}"
                                   ${slot.days.includes(day) ? 'checked' : ''}>
                            ${day}
                        </label>
                    `).join('')}
                </div>
                <button class="remove-slot-btn" data-index="${index}">Remove Time Slot</button>
            </div>
        `;
    }).join('');

    // Add event listeners
    container.querySelectorAll('input[type="time"]').forEach(input => {
        input.addEventListener('change', updateTimeSlot);
    });

    container.querySelectorAll('.day-checkbox input').forEach(checkbox => {
        checkbox.addEventListener('change', updateDays);
    });

    container.querySelectorAll('.remove-slot-btn').forEach(btn => {
        btn.addEventListener('click', removeTimeSlot);
    });
}

// Add new time slot
function addTimeSlot() {
    if (!currentEditDomain) return;

    if (!currentEditDomain.timeSlots) {
        currentEditDomain.timeSlots = [];
    }

    // Add default time slot (9 AM to 5 PM, weekdays)
    currentEditDomain.timeSlots.push({
        startTime: '09:00',
        endTime: '17:00',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    });

    renderTimeSlots();
}

// Update time slot time
function updateTimeSlot(e) {
    const index = parseInt(e.target.dataset.index);
    const field = e.target.dataset.field;

    if (currentEditDomain && currentEditDomain.timeSlots[index]) {
        currentEditDomain.timeSlots[index][field] = e.target.value;
    }
}

// Update days for time slot
function updateDays(e) {
    const index = parseInt(e.target.dataset.index);
    const day = e.target.value;
    const checked = e.target.checked;

    if (currentEditDomain && currentEditDomain.timeSlots[index]) {
        const days = currentEditDomain.timeSlots[index].days;

        if (checked && !days.includes(day)) {
            days.push(day);
        } else if (!checked) {
            const dayIndex = days.indexOf(day);
            if (dayIndex > -1) {
                days.splice(dayIndex, 1);
            }
        }

        // Update visual state
        e.target.parentElement.classList.toggle('checked', checked);
    }
}

// Remove time slot
function removeTimeSlot(e) {
    const index = parseInt(e.target.dataset.index);

    if (currentEditDomain && currentEditDomain.timeSlots) {
        currentEditDomain.timeSlots.splice(index, 1);
        renderTimeSlots();
    }
}

// Toggle time slot configuration visibility
function toggleTimeSlotConfig() {
    const alwaysBlock = document.getElementById('alwaysBlock').checked;
    const timeSlotConfig = document.getElementById('timeSlotConfig');

    timeSlotConfig.style.display = alwaysBlock ? 'none' : 'block';
}

// Save time slots
async function saveTimeSlots() {
    if (!currentEditDomain) return;

    // Update block type
    currentEditDomain.blockType = document.querySelector('input[name="blockType"]:checked').value;
    currentEditDomain.alwaysBlock = document.getElementById('alwaysBlock').checked;

    // Validate time slots if not always blocking
    if (!currentEditDomain.alwaysBlock && currentEditDomain.timeSlots) {
        for (const slot of currentEditDomain.timeSlots) {
            if (!slot.startTime || !slot.endTime) {
                alert('Please fill in all time fields');
                return;
            }
            if (slot.days.length === 0) {
                alert('Please select at least one day for each time slot');
                return;
            }
        }
    }

    await saveDomains();
    renderDomains();
    closeTimeSlotModal();

    // Force reload the current tab to apply new time slot settings immediately
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.reload(tab.id);
        }
    } catch (error) {
        console.log('Could not reload tab:', error);
    }
}

// Save domains to storage
async function saveDomains() {
    await chrome.storage.sync.set({ blockedDomainsV2: domainsData });

    // Notify background script
    chrome.runtime.sendMessage({ action: 'domainsUpdated', domains: domainsData });
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

// Setup tab navigation
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.nav-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update button states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${targetTab}-tab`) {
                    content.classList.add('active');
                }
            });

            // Load statistics when statistics tab is opened
            if (targetTab === 'statistics') {
                loadStatistics();
            }
        });
    });
}

// Load and display statistics
async function loadStatistics() {
    try {
        const stats = await chrome.runtime.sendMessage({ action: 'getStatistics' });
        console.log('WaitAMinute: Received statistics:', stats);
        displayStatistics(stats);
    } catch (error) {
        console.error('Failed to load statistics:', error);
        displayEmptyStatistics();
    }
}

// Display statistics in the UI
function displayStatistics(stats) {
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyStats?.[today] || { blockedAttempts: 0, challengesCompleted: 0, domains: {} };

    // Update summary cards
    document.getElementById('todayBlocked').textContent = todayStats.blockedAttempts;
    document.getElementById('todayCompleted').textContent = todayStats.challengesCompleted;

    // Success rate = how often the extension successfully kept user away (didn't bypass)
    const successRate = todayStats.blockedAttempts > 0
        ? Math.round(((todayStats.blockedAttempts - todayStats.challengesCompleted) / todayStats.blockedAttempts) * 100)
        : 0;
    document.getElementById('successRate').textContent = `${successRate}%`;

    // Generate 14-day chart
    renderChart(stats.dailyStats);

    // Display top domains
    renderTopDomains(stats.dailyStats);
}

// Render the 14-day chart
function renderChart(dailyStats) {
    const chartContainer = document.getElementById('chartContainer');
    const today = new Date();
    const dates = [];
    const maxValue = getMaxDailyValue(dailyStats);

    // Generate last 14 days
    for (let i = 13; i >= 0; i--) {
        const date = new Date(today.getTime() - (i * 24 * 60 * 60 * 1000));
        dates.push(date.toISOString().split('T')[0]);
    }

    // Create chart bars
    const chartBars = dates.map(date => {
        const dayStats = dailyStats[date] || { blockedAttempts: 0, challengesCompleted: 0 };
        const attempts = dayStats.blockedAttempts;
        const completed = dayStats.challengesCompleted;
        const height = maxValue > 0 ? (attempts / maxValue) * 100 : 0;

        const dayLabel = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });

        return `
            <div class="chart-bar blocked" style="height: ${height}%">
                <div class="chart-bar-tooltip">
                    ${dayLabel}: ${attempts} blocked, ${completed} completed
                </div>
            </div>
        `;
    }).join('');

    // Create labels
    const chartLabels = dates.map(date => {
        const day = new Date(date).getDate();
        return `<div class="chart-label">${day}</div>`;
    }).join('');

    chartContainer.innerHTML = `
        <div style="display: flex; align-items: end; gap: 3px; height: 100px;">
            ${chartBars}
        </div>
        <div class="chart-labels">
            ${chartLabels}
        </div>
    `;
}

// Get maximum daily value for chart scaling
function getMaxDailyValue(dailyStats) {
    let max = 0;
    for (const [date, stats] of Object.entries(dailyStats)) {
        max = Math.max(max, stats.blockedAttempts || 0);
    }
    return Math.max(max, 1); // Minimum of 1 to avoid division by zero
}

// Render top blocked domains
function renderTopDomains(dailyStats) {
    const domainTotals = {};

    // Aggregate domain stats across all days
    for (const [date, dayStats] of Object.entries(dailyStats)) {
        for (const [domain, domainStats] of Object.entries(dayStats.domains || {})) {
            if (!domainTotals[domain]) {
                domainTotals[domain] = { attempts: 0, completed: 0 };
            }
            domainTotals[domain].attempts += domainStats.attempts || 0;
            domainTotals[domain].completed += domainStats.completed || 0;
        }
    }

    // Sort by total attempts
    const sortedDomains = Object.entries(domainTotals)
        .sort(([,a], [,b]) => b.attempts - a.attempts)
        .slice(0, 5); // Top 5 domains

    const domainStatsList = document.getElementById('domainStatsList');

    if (sortedDomains.length === 0) {
        domainStatsList.innerHTML = '<div class="no-stats">No domain statistics yet</div>';
        return;
    }

    domainStatsList.innerHTML = sortedDomains.map(([domain, stats]) => `
        <div class="domain-stat-item">
            <div class="domain-stat-name">${domain}</div>
            <div class="domain-stat-numbers">
                <span class="domain-stat-attempts">${stats.attempts} blocked</span>
                <span class="domain-stat-completed">${stats.completed} completed</span>
            </div>
        </div>
    `).join('');
}

// Display empty statistics when no data is available
function displayEmptyStatistics() {
    document.getElementById('todayBlocked').textContent = '0';
    document.getElementById('todayCompleted').textContent = '0';
    document.getElementById('successRate').textContent = '0%';

    document.getElementById('chartContainer').innerHTML = '<div class="no-stats">No data available yet</div>';
    document.getElementById('domainStatsList').innerHTML = '<div class="no-stats">No domain statistics yet</div>';
}

// Reset all statistics
async function resetStatistics() {
    try {
        await chrome.runtime.sendMessage({ action: 'resetStatistics' });
        console.log('WaitAMinute: Statistics reset successfully');

        // Refresh the statistics display
        await loadStatistics();

        // Show success message
        alert('Statistics have been reset successfully.');
    } catch (error) {
        console.error('Failed to reset statistics:', error);
        alert('Failed to reset statistics. Please try again.');
    }
}