const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../shared/rules.js');

function at(day, hours, minutes) {
    // 2026-08-09 is a Sunday in the local timezone.
    return new Date(2026, 7, 9 + day, hours, minutes);
}

test('selects the most specific matching domain', () => {
    const rule = rules.matchingRule('mail.example.com', [
        { domain: 'example.com', blockType: 'soft' },
        { domain: 'mail.example.com', blockType: 'hard' }
    ]);
    assert.equal(rule.blockType, 'hard');
});

test('evaluates ordinary and overnight schedules against their start day', () => {
    assert.equal(rules.isSlotActive({ startTime: '09:00', endTime: '17:00', days: ['Mon'] }, at(1, 10, 0)), true);
    assert.equal(rules.isSlotActive({ startTime: '22:00', endTime: '02:00', days: ['Mon'] }, at(2, 1, 0)), true);
    assert.equal(rules.isSlotActive({ startTime: '22:00', endTime: '02:00', days: ['Mon'] }, at(2, 3, 0)), false);
});

test('rejects empty and equal time ranges', () => {
    assert.equal(rules.isSlotActive({ startTime: '09:00', endTime: '09:00', days: ['Mon'] }, at(1, 9, 0)), false);
    assert.equal(rules.isSlotActive({ startTime: '09:00', endTime: '17:00', days: [] }, at(1, 10, 0)), false);
});

test('uses an empty schedule for all-day blocking', () => {
    assert.equal(rules.getBlockInfo('example.com', [{ domain: 'example.com', blockType: 'soft', timeSlots: [] }]).shouldBlock, true);
});

test('validates importable rules as one complete configuration', () => {
    assert.equal(rules.validateRules([{ domain: 'example.com', blockType: 'hard', timeSlots: [] }]).length, 1);
    assert.equal(rules.validateRules([{ domain: 'example.com', blockType: 'soft', timeSlots: [{ startTime: '10:00', endTime: '10:00', days: ['Mon'] }] }]), null);
    assert.equal(rules.validateRules([{ domain: 'example.com', blockType: 'soft', timeSlots: [] }, { domain: 'example.com', blockType: 'hard', timeSlots: [] }]), null);
});
