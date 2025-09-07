// Content script that runs on all pages
(function() {
    let settings = null;
    let blockedDomains = [];
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
            if (changes.blockedDomains) {
                blockedDomains = changes.blockedDomains.newValue || [];
                checkCurrentPage();
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
        const result = await chrome.storage.sync.get(['blockedDomains']);
        blockedDomains = result.blockedDomains || [];
    }
    
    // Check if current page should be blocked
    function checkCurrentPage() {
        if (!settings || !settings.enabled) return;
        
        const currentDomain = window.location.hostname.replace(/^www\./, '');
        
        // Check if domain is in block list
        const isBlocked = blockedDomains.some(domain => {
            return currentDomain === domain || currentDomain.endsWith('.' + domain);
        });
        
        if (isBlocked) {
            // Check if domain has been bypassed recently
            const bypassTime = bypassedDomains[currentDomain];
            if (bypassTime && Date.now() - bypassTime < settings.bypassDuration * 60 * 1000) {
                return; // Still in bypass period
            }
            
            showChallenge();
        }
    }
    
    // Show challenge overlay
    function showChallenge() {
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
            container.innerHTML = createCountdownChallenge();
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            setupCountdownChallenge();
        } else if (settings.challengeType === 'turnstile' && settings.turnstileKey) {
            container.innerHTML = createTurnstileChallenge();
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            loadTurnstileScript();
        } else {
            container.innerHTML = createMathChallenge();
            overlay.appendChild(container);
            document.body.appendChild(overlay);
            setupMathChallenge();
        }
    }
    
    // Create Turnstile challenge HTML
    function createTurnstileChallenge() {
        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
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
    function createMathChallenge() {
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;
        
        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
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
                    container.innerHTML = createMathChallenge();
                    setupMathChallenge();
                }
            });
        };
        document.head.appendChild(script);
    }
    
    // Create countdown challenge HTML
    function createCountdownChallenge() {
        const waitSeconds = settings.waitDuration || 30;
        return `
            <div class="waitaminute-header">
                <h2>Wait a Minute!</h2>
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
            container.innerHTML = createMathChallenge();
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
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();