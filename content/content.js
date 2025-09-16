// Content script that runs on all pages
(function() {
    let settings = null;
    let blockedDomainsV2 = [];
    let bypassedDomains = {};

    // Initialize
    async function init() {
        await loadSettings();
        await loadBlockedDomains();
        checkCurrentPage();

        // Listen for storage changes
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (changes.settings) {
                settings = changes.settings.newValue;
            }
            if (changes.blockedDomainsV2) {
                blockedDomainsV2 = changes.blockedDomainsV2.newValue || [];
                checkCurrentPage();
            }
            // Handle legacy format updates
            if (changes.blockedDomains) {
                // Migrate to V2 format if needed
                migrateBlockedDomains(changes.blockedDomains.newValue);
            }
        });
    }

    // Load settings from storage
    async function loadSettings() {
        const result = await chrome.storage.sync.get(['settings']);
        settings = result.settings || {
            enabled: true,
            challengeType: 'countdown',
            turnstileKey: '',
            waitDuration: 30,
            bypassDuration: 10
        };
    }

    // Load blocked domains from storage
    async function loadBlockedDomains() {
        const result = await chrome.storage.sync.get(['blockedDomainsV2', 'blockedDomains']);

        if (result.blockedDomainsV2) {
            blockedDomainsV2 = result.blockedDomainsV2;
        } else if (result.blockedDomains) {
            // Migrate from old format
            blockedDomainsV2 = result.blockedDomains.map(domain => ({
                domain: domain,
                timeSlots: [],
                alwaysBlock: true,
                blockType: 'soft'
            }));
            await chrome.storage.sync.set({ blockedDomainsV2 });
        } else {
            blockedDomainsV2 = [];
        }
    }

    // Migrate old blocked domains format
    async function migrateBlockedDomains(oldDomains) {
        if (!oldDomains) return;

        blockedDomainsV2 = oldDomains.map(domain => ({
            domain: domain,
            timeSlots: [],
            alwaysBlock: true,
            blockType: 'soft'
        }));
        await chrome.storage.sync.set({ blockedDomainsV2 });
    }

    // Helper function to format 24-hour time to 12-hour format
    function formatTimeTo12Hour(time24) {
        const [hours, minutes] = time24.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const hours12 = hours % 12 || 12;
        return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`;
    }

    // Check if current time is within a time slot
    function isInTimeSlot(timeSlots) {
        if (!timeSlots || timeSlots.length === 0) {
            console.log('WaitAMinute: No time slots configured');
            return false;
        }

        const now = new Date();
        const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
        const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight

        console.log(`WaitAMinute: Checking time slots - Current: ${currentDay} ${Math.floor(currentTime/60)}:${String(currentTime%60).padStart(2,'0')}`);

        for (const slot of timeSlots) {
            console.log(`WaitAMinute: Checking slot: ${slot.startTime} to ${slot.endTime}, days: ${slot.days.join(',')}`);
            // Check if current day is in this slot
            if (!slot.days.includes(currentDay)) {
                console.log(`WaitAMinute: Day ${currentDay} not in slot days`);
                continue;
            }

            // Parse time strings
            const [startHour, startMin] = slot.startTime.split(':').map(Number);
            const [endHour, endMin] = slot.endTime.split(':').map(Number);

            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;

            // Check if current time is within the slot
            if (endMinutes > startMinutes) {
                // Normal case: start time is before end time
                if (currentTime >= startMinutes && currentTime < endMinutes) {
                    console.log(`WaitAMinute: Time slot match - ${slot.startTime} to ${slot.endTime} on ${currentDay}`);
                    return slot; // Return the matching slot instead of just true
                }
            } else {
                // Overnight case: end time is after midnight
                if (currentTime >= startMinutes || currentTime < endMinutes) {
                    console.log(`WaitAMinute: Time slot match (overnight) - ${slot.startTime} to ${slot.endTime} on ${currentDay}`);
                    return slot; // Return the matching slot instead of just true
                }
            }
        }

        return false;
    }

    // Get block info for current page
    function getBlockInfo() {
        const currentDomain = window.location.hostname.replace(/^www\./, '');

        for (const domainItem of blockedDomainsV2) {
            // Check if current domain matches
            if (currentDomain === domainItem.domain || currentDomain.endsWith('.' + domainItem.domain)) {
                // Check if should be blocked
                if (domainItem.alwaysBlock) {
                    return {
                        shouldBlock: true,
                        blockType: domainItem.blockType,
                        reason: 'Always blocked',
                        domainItem: domainItem
                    };
                } else {
                    const matchedSlot = isInTimeSlot(domainItem.timeSlots);
                    if (matchedSlot) {
                        // Format the time range nicely
                        const startTime12hr = formatTimeTo12Hour(matchedSlot.startTime);
                        const endTime12hr = formatTimeTo12Hour(matchedSlot.endTime);
                        const timeRange = `${startTime12hr} - ${endTime12hr}`;
                        return {
                            shouldBlock: true,
                            blockType: domainItem.blockType,
                            reason: `Blocked during scheduled time (${timeRange})`,
                            domainItem: domainItem
                        };
                    }
                }
            }
        }

        return { shouldBlock: false };
    }

    // Check if current page should be blocked
    function checkCurrentPage() {
        if (!settings || !settings.enabled) {
            removeOverlay();
            return;
        }

        const blockInfo = getBlockInfo();

        if (blockInfo.shouldBlock) {
            const currentDomain = window.location.hostname.replace(/^www\./, '');

            // For hard blocks, no bypass is allowed
            if (blockInfo.blockType === 'hard') {
                showHardBlock(blockInfo.reason);
                return;
            }

            // For soft blocks, check if domain has been bypassed recently
            const bypassTime = bypassedDomains[currentDomain];
            if (bypassTime && Date.now() - bypassTime < settings.bypassDuration * 60 * 1000) {
                return; // Still in bypass period
            }

            showChallenge(blockInfo.reason);
        } else {
            removeOverlay();
        }
    }

    // Remove overlay if exists
    function removeOverlay() {
        const overlay = document.getElementById('waitaminute-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    // Show hard block (no bypass option)
    function showHardBlock(reason) {
        // Check if overlay already exists
        if (document.getElementById('waitaminute-overlay')) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'waitaminute-overlay';
        overlay.className = 'waitaminute-overlay waitaminute-hard-block';

        // Create container
        const container = document.createElement('div');
        container.className = 'waitaminute-container';

        container.innerHTML = `
            <div class="waitaminute-header">
                <h2>Access Blocked</h2>
                <p class="block-reason">${reason}</p>
            </div>
            <div class="waitaminute-challenge">
                <div class="hard-block-message">
                    <div class="block-icon">🚫</div>
                    <h3>${window.location.hostname} is currently blocked</h3>
                    <p>This site has been configured with a hard block and cannot be accessed during restricted times.</p>
                    <p class="suggestion">Take this time to focus on your work or other activities.</p>
                </div>
            </div>
            <div class="waitaminute-footer">
                <p>Stay focused and productive</p>
            </div>
        `;

        overlay.appendChild(container);
        document.body.appendChild(overlay);
    }

    // Show challenge overlay (soft block)
    function showChallenge(reason) {
        // Check if overlay already exists
        if (document.getElementById('waitaminute-overlay')) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'waitaminute-overlay';
        overlay.className = 'waitaminute-overlay';

        // Create challenge container
        const container = document.createElement('div');
        container.className = 'waitaminute-container';

        // Add content based on challenge type
        if (settings.challengeType === 'countdown') {
            container.innerHTML = createCountdownChallenge(reason);
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            setupCountdownChallenge();
        } else if (settings.challengeType === 'turnstile' && settings.turnstileKey) {
            container.innerHTML = createTurnstileChallenge(reason);
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            loadTurnstileScript();
        } else {
            container.innerHTML = createMathChallenge(reason);
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            setupMathChallenge();
        }
    }

    // Create Turnstile challenge HTML
    function createTurnstileChallenge(reason) {
        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
                <p class="block-reason">${reason}</p>
                <p>Complete the challenge to access ${window.location.hostname}</p>
            </div>
            <div class="waitaminute-challenge">
                <div id="turnstile-widget"></div>
            </div>
            <div class="waitaminute-footer">
                <p>Taking a moment to think before you browse</p>
            </div>
        `;
    }

    // Create math challenge HTML
    function createMathChallenge(reason) {
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;

        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
                <p class="block-reason">${reason}</p>
                <p>Complete the challenge to access ${window.location.hostname}</p>
            </div>
            <div class="waitaminute-challenge">
                <div class="math-challenge">
                    <p class="math-question">What is ${num1} + ${num2}?</p>
                    <input type="number" id="math-answer" placeholder="Enter your answer">
                    <button id="math-submit">Submit</button>
                    <p class="math-error" id="math-error" style="display: none;">Incorrect answer. Try again!</p>
                </div>
            </div>
            <div class="waitaminute-footer">
                <p>Taking a moment to think before you browse</p>
            </div>
        ` + `<div data-answer="${answer}" style="display:none;"></div>`;
    }

    // Setup math challenge event listeners
    function setupMathChallenge() {
        const submitBtn = document.getElementById('math-submit');
        const input = document.getElementById('math-answer');
        const errorMsg = document.getElementById('math-error');

        const checkAnswer = () => {
            const userAnswer = parseInt(input.value);
            const correctAnswer = parseInt(document.querySelector('[data-answer]').dataset.answer);

            if (userAnswer === correctAnswer) {
                challengeCompleted();
            } else {
                errorMsg.style.display = 'block';
                input.value = '';
                setTimeout(() => {
                    errorMsg.style.display = 'none';
                }, 3000);
            }
        };

        submitBtn.addEventListener('click', checkAnswer);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') checkAnswer();
        });

        // Focus input
        input.focus();
    }

    // Load Turnstile script
    function loadTurnstileScript() {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        script.onload = () => {
            // Initialize Turnstile widget
            window.turnstile.render('#turnstile-widget', {
                sitekey: settings.turnstileKey,
                callback: function(token) {
                    challengeCompleted();
                },
                'error-callback': function() {
                    // Fallback to math challenge if Turnstile fails
                    const container = document.querySelector('.waitaminute-container');
                    const blockInfo = getBlockInfo();
                    container.innerHTML = createMathChallenge(blockInfo.reason || '');
                    setupMathChallenge();
                }
            });
        };
        document.head.appendChild(script);
    }

    // Create countdown challenge HTML
    function createCountdownChallenge(reason) {
        const waitSeconds = settings.waitDuration || 30;
        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
                <p class="block-reason">${reason}</p>
                <p>Please wait to access ${window.location.hostname}</p>
            </div>
            <div class="waitaminute-challenge">
                <div class="countdown-challenge">
                    <div class="countdown-circle">
                        <svg class="countdown-svg" width="200" height="200">
                            <circle class="countdown-bg" cx="100" cy="100" r="90"></circle>
                            <circle class="countdown-progress" cx="100" cy="100" r="90"></circle>
                        </svg>
                        <div class="countdown-number" id="countdown-display">${waitSeconds}</div>
                    </div>
                    <button class="skip-button" id="skip-to-math">Or solve a math problem to see ${window.location.hostname} now</button>
                </div>
            </div>
            <div class="waitaminute-footer">
                <p>Taking a moment to think before you browse</p>
            </div>
        `;
    }

    // Setup countdown challenge
    function setupCountdownChallenge() {
        const waitSeconds = settings.waitDuration || 30;
        let remainingSeconds = waitSeconds;
        const countdownDisplay = document.getElementById('countdown-display');
        const skipButton = document.getElementById('skip-to-math');
        const progressCircle = document.querySelector('.countdown-progress');

        // Calculate circumference for progress animation
        const radius = 90;
        const circumference = 2 * Math.PI * radius;
        progressCircle.style.strokeDasharray = circumference;
        progressCircle.style.strokeDashoffset = 0;

        // Start countdown
        const countdownInterval = setInterval(() => {
            remainingSeconds--;
            countdownDisplay.textContent = remainingSeconds;

            // Update progress circle
            const progress = (waitSeconds - remainingSeconds) / waitSeconds;
            const offset = circumference * (1 - progress);
            progressCircle.style.strokeDashoffset = offset;

            if (remainingSeconds <= 0) {
                clearInterval(countdownInterval);
                challengeCompleted();
            }
        }, 1000);

        // Skip to math challenge
        skipButton.addEventListener('click', () => {
            clearInterval(countdownInterval);
            const container = document.querySelector('.waitaminute-container');
            const blockInfo = getBlockInfo();
            container.innerHTML = createMathChallenge(blockInfo.reason || '');
            setupMathChallenge();
        });
    }

    // Challenge completed successfully
    function challengeCompleted() {
        const currentDomain = window.location.hostname.replace(/^www\./, '');
        bypassedDomains[currentDomain] = Date.now();

        // Remove overlay with animation
        const overlay = document.getElementById('waitaminute-overlay');
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
        }, 300);

        // Track completion (for future statistics)
        chrome.runtime.sendMessage({
            action: 'challengeCompleted',
            domain: currentDomain
        });
    }

    // Check periodically for time-based blocks
    setInterval(() => {
        checkCurrentPage();
    }, 60000); // Check every minute

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();