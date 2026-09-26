(async function () {
    const { formatTime, getBlockInfo, normaliseSettings } = WaitAMinuteRules;
    const detail = document.getElementById('detail');
    const schedule = document.getElementById('schedule');
    const leave = document.getElementById('leave');
    const nonce = new URLSearchParams(location.search).get('nonce');

    leave.textContent = history.length > 1 ? 'Go back' : 'Close tab';
    leave.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else chrome.runtime.sendMessage({ action: 'closeTab' });
    });

    // The block record is fetched once; afterwards only the rules are re-evaluated.
    const block = await chrome.runtime.sendMessage({ action: 'getHardBlock', nonce });
    if (!block?.active) {
        detail.textContent = 'This block is no longer active.';
        return;
    }

    async function evaluate() {
        const { settings, rules } = await chrome.storage.sync.get(['settings', 'rules']);
        const info = normaliseSettings(settings).enabled && getBlockInfo(new URL(block.target).hostname, rules || []);
        if (!info?.shouldBlock || info.rule.blockType !== 'hard') return location.replace(block.target);
        detail.textContent = `${block.domain} is unavailable right now.`;
        schedule.hidden = !info.slot;
        if (info.slot) schedule.textContent = `This scheduled block ends at ${formatTime(info.slot.endTime)}.`;
    }

    chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') evaluate(); });
    await evaluate();
    setInterval(evaluate, 60000);
})();
