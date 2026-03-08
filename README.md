# EtherX Standalone Browser

**Pure web version of EtherX Browser** — runs directly in any modern web browser without installation.

🌐 **Live Demo**: [https://ktrucek.github.io/etherx-standalone](https://ktrucek.github.io/etherx-standalone)

## Features

- ✅ **Zero Installation** — just open `index.html` in any browser
- ✅ **Offline Ready** — all code embedded in single HTML file
- ✅ **Privacy First** — no external server dependencies (except for n8n proxy features)
- ✅ **Full Feature Set** — AI Agent, Password Manager, Ad Blocker, QR Sync, Wallet integration
- ✅ **Responsive Design** — works on desktop, tablet, and mobile

## Quick Start

### Option 1: GitHub Pages (Recommended)
Visit: **https://ktrucek.github.io/etherx-standalone**

### Option 2: Local Usage
1. Download `src/index.html`
2. Open it in your browser
3. Done! No server needed.

### Option 3: Self-Host
```bash
# Serve with Python
python3 -m http.server 8000
# Open http://localhost:8000/src/index.html

# Or with Node.js
npx http-server -p 8000
```

## Build from Source

This is the **standalone-only repository**. For the full Electron version, see:
- **Main Repo**: [github.com/ktrucek/etherx-browser-2](https://github.com/ktrucek/etherx-browser-2)
- **Gitea Mirror**: [git.kasp.top/ktrucek/etherx-browser-2](https://git.kasp.top/ktrucek/etherx-browser-2)

## Settings

All settings stored in browser's `localStorage` under key `ex_cfg`. To reset:
```javascript
localStorage.removeItem('ex_cfg');
location.reload();
```

## License

© 2024-2026 kriptoentuzijasti.io. All Rights Reserved.  
Proprietary and Confidential — See LICENSE file.

## Support

- **Issues**: [GitHub Issues](https://github.com/ktrucek/etherx-standalone/issues)
- **Website**: [kriptoentuzijasti.io](https://kriptoentuzijasti.io)
- **Email**: support@kriptoentuzijasti.io
