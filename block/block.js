(async function () {
    const nonce = new URLSearchParams(location.search).get('nonce');
    const detail = document.getElementById('detail');
    const schedule = document.getElementById('schedule');
    const back = document.getElementById('back');
    let state = null;
    const format = (time) => new Date(`2000-01-01T${time}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    async function evaluate() {
        const response = await chrome.runtime.sendMessage({ action: 'getHardBlock', nonce });
        if (!response?.active) { detail.textContent = 'This block is no longer active.'; return; }
        state = response;
        const { settings, rules } = await chrome.storage.sync.get(['settings', 'rules']);
        const info = settings?.enabled && WaitAMinuteRules.getBlockInfo(new URL(state.target).hostname, rules || []);
        if (!info?.shouldBlock || info.rule.blockType !== 'hard') { location.replace(state.target); return; }
        detail.textContent = `${state.domain} is unavailable right now.`;
        if (info.slot) { schedule.hidden = false; schedule.textContent = `This scheduled block ends at ${format(info.slot.endTime)}.`; }
        else schedule.hidden = true;
    }
    back.addEventListener('click', () => history.back());
    chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') evaluate(); });
    await evaluate();
    setInterval(evaluate, 60000);
})();
