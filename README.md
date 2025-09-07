# WaitAMinute - Chrome Extension

A Chrome extension that adds intentional friction before accessing distracting websites by requiring users to complete a CAPTCHA or Cloudflare Turnstile challenge.

## 🎯 Purpose

WaitAMinute helps you build better browsing habits by adding a moment of pause before accessing websites you've marked as potentially distracting. This brief interruption gives you time to reconsider whether you really want to visit that site right now.

## ✨ Features

- **Domain Blocking**: Add any website domain to your blocklist
- **CAPTCHA Challenge**: Complete a verification challenge before accessing blocked sites
- **Cloudflare Turnstile Integration**: Modern, privacy-friendly challenge system
- **Fallback Options**: Simple math CAPTCHA when Turnstile is unavailable
- **Easy Management**: Simple popup interface to manage blocked domains
- **Temporary Bypass**: Successfully completing a challenge grants temporary access
- **Privacy Focused**: All data stored locally, no external tracking

## 🚀 Installation

### From Source (Development)

1. Clone this repository:
   ```bash
   git clone https://github.com/danielferguson/waitaminute.git
   cd waitaminute
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right corner

4. Click "Load unpacked" and select the `waitaminute` directory

5. The extension icon should appear in your Chrome toolbar

## 📖 Usage

1. **Add a Website to Block List**:
   - Click the WaitAMinute icon in your toolbar
   - Enter the domain you want to block (e.g., `twitter.com`, `reddit.com`)
   - Click "Add Domain"

2. **Accessing Blocked Sites**:
   - When you navigate to a blocked site, you'll see an overlay
   - Complete the CAPTCHA or Turnstile challenge
   - Upon success, you'll have temporary access to the site

3. **Managing Your Block List**:
   - Click the extension icon to view all blocked domains
   - Remove domains by clicking the "×" next to each entry
   - Use the toggle to temporarily disable the extension

## 🛠️ Configuration

### Cloudflare Turnstile Setup (Optional)

To use Cloudflare Turnstile instead of the default CAPTCHA:

1. Get your Turnstile site key from [Cloudflare Dashboard](https://dash.cloudflare.com/sign-up/turnstile)
2. Open the extension options
3. Enter your site key in the settings
4. Save and reload the extension

## 🏗️ Project Structure

```
waitaminute/
├── manifest.json           # Chrome extension manifest
├── popup/                  # Extension popup interface
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/               # Content scripts
│   ├── content.js         # Main content script
│   └── overlay.css        # Overlay styles
├── background/            # Background service worker
│   └── service-worker.js
└── assets/               # Icons and images
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📋 Roadmap

- [ ] Chrome Web Store release
- [ ] Custom challenge types (typing exercises, mindfulness prompts)
- [ ] Time-based blocking (e.g., only during work hours)
- [ ] Statistics tracking (how many times you've reconsidered)
- [ ] Sync settings across devices
- [ ] Firefox extension port
- [ ] Custom timeout durations
- [ ] Whitelist mode (block everything except specified sites)

## 🐛 Known Issues

- Turnstile challenges may not work on some corporate networks
- Some websites with complex routing may require page refresh after unlock

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- Inspired by productivity tools and digital wellness initiatives
- Uses Cloudflare Turnstile for privacy-friendly challenges
- Built with vanilla JavaScript for minimal dependencies

## 📧 Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Remember**: The goal isn't to block websites forever, but to add just enough friction to make you pause and think: "Do I really need to visit this site right now?"