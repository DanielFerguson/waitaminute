// Runs in an isolated world. The overlay is a modal <dialog> in a closed Shadow DOM: it sits in the top layer,
// makes the page inert (so the page can't steal focus) and is out of reach of page CSS and scripts.
(function () {
    const { normaliseSettings, normaliseHostname, getBlockInfo } = WaitAMinuteRules;
    const hostname = normaliseHostname(location.hostname);
    let settings = normaliseSettings();
    let rules = [];
    let host = null;
    let signature = null;
    let countdownTimer = null;
    let recheckTimer = null;
    let attemptTracked = false;
    let redirecting = false;

    const el = (tag, props = {}, ...children) => {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    };
    // Prerendered pages may never be shown, so anything the user should "experience" waits until activation.
    const activation = () => document.prerendering
        ? new Promise((resolve) => document.addEventListener('prerenderingchange', resolve, { once: true }))
        : Promise.resolve();
    const holdMedia = (event) => event.target.pause?.();

    async function load() {
        const data = await chrome.storage.sync.get(['settings', 'rules']);
        settings = normaliseSettings(data.settings);
        rules = data.rules || [];
    }

    async function checkCurrentPage() {
        if (!chrome.runtime?.id) return clearInterval(recheckTimer); // Orphaned after an extension update.
        const info = settings.enabled ? getBlockInfo(hostname, rules) : { shouldBlock: false };
        armRecheck(Boolean(info.rule));
        if (!info.shouldBlock) { attemptTracked = false; return removeOverlay(); }
        if (info.rule.blockType === 'hard') return hardBlock(info.rule.domain);
        const { bypasses = {} } = await chrome.storage.local.get('bypasses');
        if (bypasses[info.rule.domain] > Date.now()) { attemptTracked = false; return removeOverlay(); }
        showOverlay(info);
    }

    // Schedules and bypasses expire with time, so pages covered by a rule are re-checked every minute.
    function armRecheck(active) {
        if (active && !recheckTimer) recheckTimer = setInterval(checkCurrentPage, 60000);
        if (!active) { clearInterval(recheckTimer); recheckTimer = null; }
    }

    async function hardBlock(domain) {
        if (redirecting) return;
        redirecting = true;
        window.stop(); // Nothing more of the page loads, paints or plays while the block page is prepared.
        await activation();
        const response = await chrome.runtime.sendMessage({ action: 'createHardBlock', target: location.href, domain });
        if (response?.url) location.replace(response.url);
    }

    function removeOverlay() {
        clearInterval(countdownTimer);
        countdownTimer = null;
        document.removeEventListener('play', holdMedia, true);
        host?.remove();
        host = null;
        signature = null;
    }

    function showOverlay(info) {
        const next = `${info.rule.domain}:${settings.challengeType}:${settings.waitDuration}`;
        if (host?.isConnected && signature === next) return;
        removeOverlay();
        signature = next;

        host = el('div', { id: 'waitaminute-extension-root' });
        const shadow = host.attachShadow({ mode: 'closed' });
        const dialog = el('dialog');
        dialog.setAttribute('aria-labelledby', 'title');
        dialog.addEventListener('cancel', (event) => event.preventDefault());
        // Chrome closes a dialog on a repeated Escape even when cancel is prevented, so re-open it.
        dialog.addEventListener('close', () => { if (dialog.isConnected) dialog.showModal(); });
        shadow.append(el('style', { textContent: STYLES }), dialog);
        document.documentElement.appendChild(host);
        dialog.showModal();
        renderChallenge(dialog, info, settings.challengeType);

        document.querySelectorAll('video, audio').forEach((media) => media.pause());
        document.addEventListener('play', holdMedia, true);

        if (!attemptTracked) {
            attemptTracked = true;
            activation().then(() => chrome.runtime.sendMessage({ action: 'blockedAttempt', domain: info.rule.domain }));
        }
    }

    function renderChallenge(dialog, info, type) {
        clearInterval(countdownTimer);
        dialog.replaceChildren(
            el('h2', { id: 'title', textContent: 'Wait a minute' }),
            el('p', { className: 'reason', textContent: info.reason }),
            el('p', { textContent: `Pause before opening ${hostname}.` }),
            type === 'math' ? mathChallenge(info) : countdownChallenge(dialog, info),
            el('button', { className: 'leave', textContent: history.length > 1 ? 'Go back' : 'Close tab', onclick: leave }),
            el('footer', { textContent: 'Taking a moment to think before you browse' })
        );
        dialog.querySelector('input, button').focus();
    }

    function mathChallenge(info) {
        const first = Math.floor(Math.random() * 10) + 1;
        const second = Math.floor(Math.random() * 10) + 1;
        const input = el('input', { type: 'number', inputMode: 'numeric', ariaLabel: 'Math answer' });
        const error = el('p', { className: 'error', role: 'alert', hidden: true, textContent: 'That is not right. Try again.' });
        const check = () => {
            if (Number(input.value) === first + second) return complete(info.rule.domain);
            error.hidden = false;
            input.value = '';
            input.focus();
        };
        input.addEventListener('keydown', (event) => { if (event.key === 'Enter') check(); });
        return el('div', { className: 'challenge' },
            el('p', { className: 'question', textContent: `What is ${first} + ${second}?` }),
            input,
            el('button', { className: 'primary', textContent: 'Continue', onclick: check }),
            error
        );
    }

    function countdownChallenge(dialog, info) {
        const seconds = settings.waitDuration;
        let remaining = seconds;
        const number = el('span', { textContent: remaining });
        const ring = el('div', { className: 'ring', role: 'timer', ariaLabel: 'Seconds remaining' }, number);
        countdownTimer = setInterval(() => {
            if (document.hidden) return; // Only time spent looking at this page counts.
            remaining -= 1;
            number.textContent = remaining;
            ring.style.setProperty('--progress', remaining / seconds);
            if (remaining <= 0) complete(info.rule.domain);
        }, 1000);
        return el('div', { className: 'challenge' },
            ring,
            el('button', { textContent: 'Solve a quick math problem instead', onclick: () => renderChallenge(dialog, info, 'math') })
        );
    }

    function leave() {
        if (history.length > 1) history.back();
        else chrome.runtime.sendMessage({ action: 'closeTab' });
    }

    async function complete(domain) {
        removeOverlay();
        await chrome.runtime.sendMessage({ action: 'createBypass', domain, minutes: settings.bypassDuration });
        chrome.runtime.sendMessage({ action: 'challengeCompleted', domain });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) settings = normaliseSettings(changes.settings.newValue);
        if (area === 'sync' && changes.rules) rules = changes.rules.newValue || [];
        // A bypass created in any tab unlocks every tab of that domain straight away.
        if (area === 'sync' || changes.bypasses) checkCurrentPage();
    });
    document.addEventListener('visibilitychange', () => { if (recheckTimer && !document.hidden) checkCurrentPage(); });
    window.addEventListener('pageshow', (event) => { if (event.persisted) checkCurrentPage(); });

    const STYLES = `
        :host { all: initial !important; }
        dialog {
            --surface: #fff; --text: #17201a; --muted: #58655c; --line: #dce5df; --accent: #287140; --on-accent: #fff;
            --danger: #a62323; --danger-bg: #fdecec;
            color-scheme: light dark;
            box-sizing: border-box;
            width: min(400px, calc(100% - 32px));
            padding: 36px 32px 24px;
            border: 0;
            border-radius: 16px;
            background: var(--surface);
            color: var(--text);
            font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            text-align: center;
            box-shadow: 0 20px 60px rgb(0 0 0 / 30%);
            animation: rise 0.3s ease;
        }
        dialog::backdrop { background: rgb(0 0 0 / 95%); backdrop-filter: blur(10px); }
        @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
        h2 { margin: 0 0 6px; font-size: 26px; font-weight: 600; }
        p { margin: 0; color: var(--muted); }
        .reason { font-size: 14px; font-style: italic; }
        .challenge { display: grid; justify-items: center; gap: 14px; margin: 24px 0 12px; }
        .ring {
            display: grid;
            place-items: center;
            width: 150px;
            aspect-ratio: 1;
            border-radius: 50%;
            background: conic-gradient(var(--accent) calc(var(--progress, 1) * 1turn), var(--line) 0);
        }
        .ring span {
            display: grid;
            place-items: center;
            width: calc(100% - 16px);
            aspect-ratio: 1;
            border-radius: 50%;
            background: var(--surface);
            font-size: 44px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        .question { font-size: 22px; font-weight: 500; color: var(--text); }
        input {
            box-sizing: border-box;
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--line);
            border-radius: 8px;
            background: var(--surface);
            color: var(--text);
            font: inherit;
            font-size: 18px;
            text-align: center;
        }
        input:focus { outline: none; border-color: var(--accent); }
        input::-webkit-inner-spin-button { appearance: none; }
        button {
            padding: 11px 20px;
            border: 2px solid var(--line);
            border-radius: 8px;
            background: transparent;
            color: var(--muted);
            font: inherit;
            font-size: 15px;
            cursor: pointer;
        }
        button:hover { border-color: var(--accent); color: var(--accent); }
        button:focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
        .primary { width: 100%; border-color: var(--accent); background: var(--accent); color: var(--on-accent); font-weight: 600; }
        .primary:hover { color: var(--on-accent); filter: brightness(1.1); }
        .leave { padding: 6px 12px; border: 0; text-decoration: underline; }
        .error { box-sizing: border-box; width: 100%; padding: 8px; border-radius: 6px; background: var(--danger-bg); color: var(--danger); font-size: 14px; }
        footer { margin-top: 12px; color: var(--muted); font-size: 13px; font-style: italic; }
        @media (prefers-color-scheme: dark) {
            dialog {
                --surface: #1b221e; --text: #e6ede8; --muted: #a2b0a6; --line: #36433a; --accent: #5cb176; --on-accent: #0f1a12;
                --danger: #ff9b9b; --danger-bg: #3a2222;
            }
        }
        @media (max-width: 480px) {
            dialog { padding: 28px 20px 20px; }
            h2 { font-size: 22px; }
            .ring { width: 120px; }
            .ring span { font-size: 34px; }
        }
        @media (prefers-reduced-motion: reduce) {
            dialog { animation: none; }
        }
    `;

    load().then(checkCurrentPage).catch(removeOverlay);
})();
