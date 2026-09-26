const { DAYS, formatTime, normaliseHostname, normaliseSettings, recentDateKeys, validateRules } = WaitAMinuteRules;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const PRESETS = {
    weekday: [{ startTime: '09:00', endTime: '17:00', days: WEEKDAYS }],
    evening: [{ startTime: '17:00', endTime: '21:00', days: WEEKDAYS }],
    daily: [{ startTime: '09:00', endTime: '17:00', days: DAYS }]
};
let state = { settings: normaliseSettings(), rules: [] };
let editing = null;
let confirmation = null;
let statusTimer = null;
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const [sync, local] = await Promise.all([
        chrome.storage.sync.get(['settings', 'rules']),
        chrome.storage.local.get('onboardingAcknowledged')
    ]);
    state = { settings: normaliseSettings(sync.settings), rules: validateRules(sync.rules) || [] };
    bind();
    showApp(Boolean(local.onboardingAcknowledged));
    renderSettings();
    renderRules();
    renderStats();
}

function bind() {
    $('acknowledge').onclick = async () => {
        await chrome.storage.local.set({ onboardingAcknowledged: true });
        showApp(true);
    };
    $('addButton').onclick = addRule;
    $('domainInput').onkeydown = (event) => { if (event.key === 'Enter') addRule(); };
    $('domainList').onclick = (event) => {
        const { domain } = event.target.dataset;
        if (event.target.matches('[data-edit]')) openRule(state.rules.find((rule) => rule.domain === domain));
        if (event.target.matches('[data-remove]')) ask(`Remove ${domain}?`, 'This will stop blocking the domain.', () => removeRule(domain));
    };
    $('enableToggle').onchange = () => saveSettings({ enabled: $('enableToggle').checked });
    $('challengeType').onchange = () => saveSettings({ challengeType: $('challengeType').value });
    $('waitDuration').onchange = () => saveSettings({ waitDuration: $('waitDuration').value });
    $('bypassDuration').onchange = () => saveSettings({ bypassDuration: $('bypassDuration').value });
    document.querySelectorAll('.tab').forEach((tab) => { tab.onclick = () => selectTab(tab.dataset.tab); });
    $('scheduleMode').onchange = applyScheduleMode;
    $('addTimeSlot').onclick = () => { editing.timeSlots.push(defaultSlot()); renderSlots(); };
    $('timeSlotList').onclick = removeSlot;
    $('timeSlotList').onchange = editSlot;
    $('closeRule').onclick = () => $('ruleDialog').close();
    $('cancelRule').onclick = () => $('ruleDialog').close();
    $('ruleForm').onsubmit = saveRule;
    $('exportConfig').onclick = exportConfig;
    $('importConfig').onchange = importConfig;
    $('resetStatistics').onclick = () => ask('Reset statistics?', 'This permanently deletes local statistics only.', resetStatistics);
    $('confirmAction').onclick = () => confirmation?.();
}

function showApp(acknowledged) {
    $('onboarding').hidden = acknowledged;
    $('app').hidden = !acknowledged;
}

function renderSettings() {
    const { enabled, challengeType, waitDuration, bypassDuration } = state.settings;
    $('enableToggle').checked = enabled;
    $('challengeType').value = challengeType;
    $('waitDuration').value = waitDuration;
    $('bypassDuration').value = bypassDuration;
    $('waitDurationSection').hidden = challengeType !== 'countdown';
}

function renderRules() {
    $('domainList').innerHTML = state.rules.map((rule) => {
        const domain = escapeHtml(rule.domain);
        return `<article class="rule">
            <div><strong>${domain}</strong><p>${rule.blockType === 'hard' ? 'Hard block' : 'Soft block'} · ${escapeHtml(scheduleText(rule))}</p></div>
            <div><button data-edit data-domain="${domain}">Edit</button><button data-remove data-domain="${domain}" aria-label="Remove ${domain}">Remove</button></div>
        </article>`;
    }).join('') || '<p class="empty">No blocked domains yet.</p>';
}

function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
}

function scheduleText(rule) {
    const preset = presetName(rule.timeSlots);
    if (preset !== 'custom') return $('scheduleMode').querySelector(`option[value="${preset}"]`).textContent;
    if (rule.timeSlots.length > 1) return `${rule.timeSlots.length} schedules`;
    const [slot] = rule.timeSlots;
    return `${formatTime(slot.startTime)}–${formatTime(slot.endTime)} · ${slot.days.length === 7 ? 'Daily' : slot.days.join(', ')}`;
}

// Accepts a bare domain or a pasted URL, including internationalised names.
function domainFromInput(value) {
    const text = value.trim();
    try {
        return normaliseHostname(new URL(text.includes('://') ? text : `https://${text}`).hostname);
    } catch {
        return normaliseHostname(text);
    }
}

function addRule() {
    const domain = domainFromInput($('domainInput').value);
    if (!validateRules([{ domain, blockType: 'soft', timeSlots: [] }])) return status('Enter a valid domain, such as example.com.', true);
    if (state.rules.some((rule) => rule.domain === domain)) return status('That domain is already blocked.', true);
    openRule({ domain, blockType: 'soft', timeSlots: [] });
}

function openRule(rule) {
    editing = structuredClone(rule);
    $('ruleTitle').textContent = state.rules.some((item) => item.domain === rule.domain) ? 'Edit domain' : 'Block domain';
    $('modalDomain').textContent = editing.domain;
    document.querySelector(`input[name="blockType"][value="${editing.blockType}"]`).checked = true;
    $('scheduleMode').value = presetName(editing.timeSlots);
    $('ruleError').hidden = true;
    renderSlots();
    $('ruleDialog').showModal();
}

// Compares by value: chrome.storage returns object keys sorted, so JSON.stringify comparisons never match.
function slotsKey(slots) {
    return slots.map(({ startTime, endTime, days }) => `${startTime}-${endTime}:${days.join(',')}`).join(';');
}

function presetName(slots) {
    const preset = Object.keys(PRESETS).find((name) => slotsKey(slots) === slotsKey(PRESETS[name]));
    return preset || (slots.length ? 'custom' : 'all-day');
}

function defaultSlot() {
    return structuredClone(PRESETS.weekday[0]);
}

function applyScheduleMode() {
    const mode = $('scheduleMode').value;
    if (mode === 'all-day') editing.timeSlots = [];
    else if (mode in PRESETS) editing.timeSlots = structuredClone(PRESETS[mode]);
    else if (!editing.timeSlots.length) editing.timeSlots = [defaultSlot()];
    renderSlots();
}

function renderSlots() {
    const custom = $('scheduleMode').value === 'custom';
    $('customSchedule').hidden = !custom;
    if (!custom) return;
    $('timeSlotList').innerHTML = editing.timeSlots.map((slot, index) => `<div class="slot">
        <input data-time="startTime" data-index="${index}" type="time" value="${slot.startTime}" aria-label="Start time">
        <span>to</span>
        <input data-time="endTime" data-index="${index}" type="time" value="${slot.endTime}" aria-label="End time">
        <button type="button" data-slot-remove="${index}">Remove</button>
        <div class="days">${DAYS.map((day) => `<label><input data-day="${day}" data-index="${index}" type="checkbox" ${slot.days.includes(day) ? 'checked' : ''}>${day}</label>`).join('')}</div>
    </div>`).join('');
}

function removeSlot(event) {
    const index = Number(event.target.dataset.slotRemove);
    if (!Number.isInteger(index)) return;
    editing.timeSlots.splice(index, 1);
    renderSlots();
}

function editSlot(event) {
    const { time, day, index } = event.target.dataset;
    const slot = editing.timeSlots[Number(index)];
    if (time) slot[time] = event.target.value;
    // Rebuild from DAYS so the stored order stays canonical (and presets keep matching).
    if (day) slot.days = DAYS.filter((item) => (item === day ? event.target.checked : slot.days.includes(item)));
}

async function saveRule(event) {
    event.preventDefault();
    editing.blockType = document.querySelector('input[name="blockType"]:checked').value;
    let error = '';
    if ($('scheduleMode').value === 'custom' && !editing.timeSlots.length) error = 'Add at least one time slot.';
    else if (!validateRules([editing])) error = 'Each time slot needs different start and end times and at least one day.';
    $('ruleError').textContent = error;
    $('ruleError').hidden = !error;
    if (error) return;
    const index = state.rules.findIndex((rule) => rule.domain === editing.domain);
    if (index < 0) {
        state.rules.push(editing);
        $('domainInput').value = '';
    } else {
        state.rules[index] = editing;
    }
    await saveRules();
    $('ruleDialog').close();
    status('Rule saved.');
}

async function removeRule(domain) {
    state.rules = state.rules.filter((rule) => rule.domain !== domain);
    await saveRules();
    status('Rule removed.');
}

async function saveRules() {
    await chrome.storage.sync.set({ rules: state.rules });
    renderRules();
}

async function saveSettings(change) {
    state.settings = normaliseSettings({ ...state.settings, ...change });
    await chrome.storage.sync.set({ settings: state.settings });
    renderSettings();
}

function selectTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        const active = tab.dataset.tab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${name}-tab`));
}

function ask(title, text, action) {
    confirmation = action;
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmDialog').showModal();
}

async function resetStatistics() {
    await chrome.runtime.sendMessage({ action: 'resetStatistics' });
    await renderStats();
    status('Statistics reset.');
}

function exportConfig() {
    const payload = { format: 'waitaminute-config', version: 1, settings: state.settings, rules: state.rules };
    const href = `data:application/json,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
    Object.assign(document.createElement('a'), { href, download: 'waitaminute-settings.json' }).click();
    status('Settings exported.');
}

async function importConfig(event) {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    try {
        const config = JSON.parse(await file.text());
        const rules = config.format === 'waitaminute-config' && config.version === 1 && validateRules(config.rules);
        if (!rules || typeof config.settings !== 'object' || !config.settings) throw new Error('Invalid configuration');
        const settings = normaliseSettings(config.settings);
        const summary = `Import ${rules.length} domain rule${rules.length === 1 ? '' : 's'} and replace your current settings.`;
        ask('Replace configuration?', summary, async () => {
            state = { settings, rules };
            await chrome.storage.sync.set({ settings, rules });
            renderSettings();
            renderRules();
            status('Configuration imported.');
        });
    } catch {
        status('That is not a valid WaitAMinute settings file.', true);
    }
}

// Reads storage directly so opening the popup doesn't have to wake the service worker.
async function renderStats() {
    const { statistics } = await chrome.storage.local.get('statistics');
    const dates = recentDateKeys(14);
    const days = dates.map((date) => statistics?.dailyStats?.[date] || { blockedAttempts: 0, challengesCompleted: 0, domains: {} });
    const today = days.at(-1);
    const paused = today.blockedAttempts ? Math.max(0, Math.round((1 - today.challengesCompleted / today.blockedAttempts) * 100)) : 0;
    $('todayBlocked').textContent = today.blockedAttempts;
    $('todayCompleted').textContent = today.challengesCompleted;
    $('successRate').textContent = `${paused}%`;

    const max = Math.max(1, ...days.map((day) => day.blockedAttempts));
    const total = days.reduce((sum, day) => sum + day.blockedAttempts, 0);
    $('chartContainer').setAttribute('aria-label', `${total} blocks in the past 14 days`);
    $('chartContainer').innerHTML = days
        .map((day, index) => `<div title="${dates[index]}: ${day.blockedAttempts} blocks" style="height:${(day.blockedAttempts / max) * 100}%"></div>`)
        .join('');

    const totals = {};
    days.forEach((day) => Object.entries(day.domains || {}).forEach(([domain, value]) => {
        totals[domain] = (totals[domain] || 0) + value.attempts;
    }));
    $('domainStatsList').innerHTML = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([domain, count]) => `<p>${escapeHtml(domain)} <strong>${count}</strong></p>`)
        .join('') || '<p class="empty">No statistics yet.</p>';
}

function status(message, error = false) {
    clearTimeout(statusTimer);
    $('statusMessage').textContent = message;
    $('statusMessage').classList.toggle('error', error);
    statusTimer = setTimeout(() => { $('statusMessage').textContent = ''; }, 4000);
}
