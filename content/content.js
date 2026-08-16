// Runs in an isolated world. UI is rendered in a Shadow DOM to avoid page CSS/DOM collisions.
(function () {
    const defaults = { enabled: true, challengeType: 'countdown', waitDuration: 30, bypassDuration: 10 };
    let settings = defaults;
    let rules = [];
    let countdownTimer = null;
    let styleText = null;
    let attemptTracked = false;

    const hostname = () => WaitAMinuteRules.normaliseHostname(window.location.hostname);
    const root = () => document.getElementById('waitaminute-extension-root');

    async function load() {
        const data = await chrome.storage.sync.get(['settings', 'rules']);
        settings = { ...defaults, ...(data.settings || {}) };
        rules = data.rules || [];
    }

    async function checkCurrentPage() {
        if (!settings.enabled) return removeOverlay();
        const info = WaitAMinuteRules.getBlockInfo(hostname(), rules);
        if (!info.shouldBlock) { attemptTracked = false; return removeOverlay(); }

        if (info.rule.blockType === 'hard') {
            const response = await chrome.runtime.sendMessage({ action: 'createHardBlock', target: location.href, domain: info.rule.domain });
            if (response?.url) location.replace(response.url);
            return;
        }
        if (info.rule.blockType !== 'hard') {
            const response = await chrome.runtime.sendMessage({
                action: 'getBypass', domain: info.rule.domain
            });
            if (response && response.active) return removeOverlay();
        }
        await showOverlay(info);
    }

    function removeOverlay() {
        clearInterval(countdownTimer);
        countdownTimer = null;
        root()?.remove();
    }

    async function overlayStyles() {
        if (styleText !== null) return styleText;
        try {
            const response = await fetch(chrome.runtime.getURL('content/overlay.css'));
            styleText = await response.text();
        } catch (_) {
            styleText = '.waitaminute-overlay{position:fixed;inset:0;display:grid;place-items:center;background:#111;color:#111}.waitaminute-container{background:#fff;padding:2rem;border-radius:1rem;max-width:24rem;text-align:center}button{padding:.75rem}';
        }
        return styleText;
    }

    async function showOverlay(info) {
        const existing = root();
        if (existing?.dataset.signature === `${info.rule.domain}:${settings.challengeType}:${settings.waitDuration}`) return;
        removeOverlay();

        const host = document.createElement('div');
        host.id = 'waitaminute-extension-root';
        host.dataset.signature = `${info.rule.domain}:${settings.challengeType}:${settings.waitDuration}`;
        const shadow = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent = await overlayStyles();
        shadow.appendChild(style);

        const overlay = document.createElement('div');
        overlay.className = 'waitaminute-overlay';
        const container = document.createElement('section');
        container.className = 'waitaminute-container';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        overlay.appendChild(container);
        shadow.appendChild(overlay);
        (document.body || document.documentElement).appendChild(host);

        renderChallenge(container, info);
        trapFocus(shadow, container);
        if (!attemptTracked) {
            attemptTracked = true;
            chrome.runtime.sendMessage({ action: 'blockedAttempt', domain: hostname() });
        }
    }

    function addHeader(container, heading, reason, detail) {
        const header = document.createElement('div');
        header.className = 'waitaminute-header';
        const title = document.createElement('h2');
        title.textContent = heading;
        const reasonText = document.createElement('p');
        reasonText.className = 'block-reason';
        reasonText.textContent = reason;
        const description = document.createElement('p');
        description.textContent = detail;
        header.append(title, reasonText, description);
        container.appendChild(header);
    }

    function trapFocus(shadow, container) {
        shadow.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const focusable = [...container.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')];
            if (!focusable.length) return;
            const first = focusable[0]; const last = focusable.at(-1);
            if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
        });
    }

    function addFooter(container) {
        const footer = document.createElement('div');
        footer.className = 'waitaminute-footer';
        footer.textContent = 'Taking a moment to think before you browse';
        container.appendChild(footer);
    }

    function renderChallenge(container, info, challengeType = settings.challengeType) {
        addHeader(container, 'Wait a minute', info.reason, `Pause before opening ${hostname()}.`);
        if (challengeType === 'math') renderMath(container, info);
        else renderCountdown(container, info);
        addFooter(container);
    }

    function renderMath(container, info) {
        const first = Math.floor(Math.random() * 10) + 1;
        const second = Math.floor(Math.random() * 10) + 1;
        const challenge = document.createElement('div');
        challenge.className = 'math-challenge waitaminute-challenge';
        const question = document.createElement('p');
        question.className = 'math-question';
        question.textContent = `What is ${first} + ${second}?`;
        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.id = 'math-answer';
        input.setAttribute('aria-label', 'Math answer');
        const submit = document.createElement('button');
        submit.id = 'math-submit';
        submit.textContent = 'Continue';
        const error = document.createElement('p');
        error.className = 'math-error';
        error.hidden = true;
        error.setAttribute('role', 'alert');
        error.textContent = 'That is not right. Try again.';
        const check = () => {
            if (Number(input.value) === first + second) complete(info.rule.domain);
            else { error.hidden = false; input.value = ''; input.focus(); }
        };
        submit.addEventListener('click', check);
        input.addEventListener('keydown', (event) => { if (event.key === 'Enter') check(); });
        challenge.append(question, input, submit, error);
        container.appendChild(challenge);
        input.focus();
    }

    function renderCountdown(container, info) {
        const seconds = Math.min(300, Math.max(5, Number(settings.waitDuration) || defaults.waitDuration));
        let remaining = seconds;
        const challenge = document.createElement('div');
        challenge.className = 'countdown-challenge waitaminute-challenge';
        const display = document.createElement('div');
        display.className = 'countdown-number';
        display.setAttribute('role', 'timer');
        display.setAttribute('aria-live', 'polite');
        display.textContent = String(remaining);
        const alternative = document.createElement('button');
        alternative.className = 'skip-button';
        alternative.textContent = 'Solve a quick math problem instead';
        alternative.addEventListener('click', () => {
            clearInterval(countdownTimer);
            countdownTimer = null;
            container.replaceChildren();
            renderChallenge(container, info, 'math');
        });
        challenge.append(display, alternative);
        container.appendChild(challenge);
        countdownTimer = setInterval(() => {
            remaining -= 1;
            display.textContent = String(Math.max(0, remaining));
            if (remaining <= 0) { clearInterval(countdownTimer); complete(info.rule.domain); }
        }, 1000);
        alternative.focus();
    }

    async function complete(ruleDomain) {
        removeOverlay();
        await chrome.runtime.sendMessage({ action: 'createBypass', domain: ruleDomain, minutes: settings.bypassDuration });
        chrome.runtime.sendMessage({ action: 'challengeCompleted', domain: hostname() });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes.settings) settings = { ...defaults, ...(changes.settings.newValue || {}) };
        if (changes.rules) rules = changes.rules.newValue || [];
        checkCurrentPage();
    });

    load().then(checkCurrentPage).catch(() => removeOverlay());
    setInterval(checkCurrentPage, 60000);
})();
