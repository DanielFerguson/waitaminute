/* Shared, side-effect-free blocking rules for every extension context. */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.WaitAMinuteRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function normaliseHostname(value) {
        return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    }

    function domainMatches(hostname, domain) {
        const host = normaliseHostname(hostname);
        const candidate = normaliseHostname(domain);
        return Boolean(candidate) && (host === candidate || host.endsWith(`.${candidate}`));
    }

    function matchingRule(hostname, rules) {
        return (rules || [])
            .filter((rule) => domainMatches(hostname, rule.domain))
            .sort((a, b) => normaliseHostname(b.domain).length - normaliseHostname(a.domain).length)[0] || null;
    }

    function minutesFromTime(value) {
        const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return null;
        return (hours * 60) + minutes;
    }

    function localDateKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isSlotActive(slot, date = new Date()) {
        const start = minutesFromTime(slot.startTime);
        const end = minutesFromTime(slot.endTime);
        const days = Array.isArray(slot.days) ? slot.days : [];
        if (start === null || end === null || days.length === 0 || start === end) return false;

        const now = (date.getHours() * 60) + date.getMinutes();
        const today = date.getDay();
        if (end > start) return days.includes(DAYS[today]) && now >= start && now < end;

        // An overnight slot belongs to the day on which it starts.
        if (now >= start) return days.includes(DAYS[today]);
        if (now < end) return days.includes(DAYS[(today + 6) % 7]);
        return false;
    }

    function getBlockInfo(hostname, rules, date = new Date()) {
        const rule = matchingRule(hostname, rules);
        if (!rule) return { shouldBlock: false };
        if (!Array.isArray(rule.timeSlots) || rule.timeSlots.length === 0) {
            return { shouldBlock: true, rule, reason: 'Blocked all day' };
        }
        const slot = (rule.timeSlots || []).find((candidate) => isSlotActive(candidate, date));
        if (!slot) return { shouldBlock: false, rule };
        return { shouldBlock: true, rule, slot, reason: 'Blocked during a scheduled time' };
    }

    function validateRules(value) {
        if (!Array.isArray(value)) return null;
        const seen = new Set();
        const rules = [];
        for (const item of value) {
            const domain = normaliseHostname(item?.domain);
            if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(domain) || seen.has(domain)) return null;
            if (!['soft', 'hard'].includes(item.blockType)) return null;
            const timeSlots = item.timeSlots || [];
            if (!Array.isArray(timeSlots)) return null;
            for (const slot of timeSlots) {
                if (minutesFromTime(slot.startTime) === null || minutesFromTime(slot.endTime) === null ||
                    slot.startTime === slot.endTime || !Array.isArray(slot.days) ||
                    slot.days.length === 0 || slot.days.some((day) => !DAYS.includes(day))) return null;
            }
            seen.add(domain);
            rules.push({ domain, blockType: item.blockType, timeSlots: structuredClone(timeSlots) });
        }
        return rules;
    }

    return { DAYS, normaliseHostname, domainMatches, matchingRule, minutesFromTime, localDateKey, isSlotActive, getBlockInfo, validateRules };
});
