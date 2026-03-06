# EtherX Browser - Desktop App

**Multi-platform Web3 browser** built with Electron, featuring integrated crypto wallet, privacy controls, and developer tools.

## 🚀 Download

### Latest Release
👉 **[Download from GitHub Releases](https://github.com/ktrucek/etherx-browser-2/releases/latest)**

### Desktop Applications
- **🐧 Linux AppImage**: Portable, runs on any distro
- **🐧 Linux .deb**: Ubuntu / Debian installer  
- **🪟 Windows .exe**: Portable, no install needed
- **🪟 Windows .zip**: ZIP archive
- **🍎 macOS .dmg (Intel)**: Disk image for x64 Macs
- **🍎 macOS .dmg (ARM)**: Disk image for Apple Silicon
- **🍎 macOS .zip**: ZIP archives for both architectures

### Other Versions
- **📱 Mobile (React Native)**: [https://github.com/ktrucek/etherx-mobile](https://github.com/ktrucek/etherx-mobile)
- **🌐 Web Version (PWA)**: [https://n8n.kriptoentuzijasti.io/browser.html](https://n8n.kriptoentuzijasti.io/browser.html)

## ✨ Features

- 🌐 **Full Web Browser** - Multi-tab browsing with modern UI
- 💰 **Crypto Wallet** - Built-in Ethereum wallet (MetaMask compatible)
- 🔐 **Privacy First** - Tracking protection, ad blocking, private mode
- 🛡️ **Security** - Biometric auth, password manager, master password encryption
- 🎨 **Customizable** - Themes, extensions, appearance settings
- 🔧 **Developer Tools** - Chrome DevTools integrated
- 🌍 **Multi-language** - Croatian, English, Spanish, German, French
- 🤖 **AI Assistant** - Built-in AI chatbot with WordPress integration

## ⚙️ Install Notes

**Linux AppImage:**
```bash
chmod +x "EtherX Browser-*.AppImage"
./"EtherX Browser-*.AppImage" --no-sandbox
```

**Linux .deb:**
```bash
sudo dpkg -i etherx-browser_*.deb
```

**Windows:** 
Double-click `.exe` — no installation required.

**macOS:** 
Open `.dmg`, drag to Applications. 

⚠️ **Note**: This is an unsigned build. On first launch, you may need to allow it via:
`System Settings → Privacy & Security → "Open Anyway"`

## 🏗️ Build from Source

```bash
# Clone
git clone https://github.com/ktrucek/etherx-browser-2.git
cd etherx-browser-2

# Install dependencies
npm install

# Run development
npm start

# Build for your platform
npm run dist:mac    # macOS
npm run dist:win    # Windows  
npm run dist:linux  # Linux
```

## 🚀 GitHub Actions CI/CD

This repository uses GitHub Actions to automatically build for all platforms.

### Trigger a build:

1. Go to [Actions tab](https://github.com/ktrucek/etherx-browser-2/actions)
2. Click "🔨 Build EtherX Browser"
3. Click "Run workflow"
4. Enter version (e.g. `2.3.1`) and select "Create GitHub Release"
5. Click "Run workflow"

Builds will appear in the [Releases](https://github.com/ktrucek/etherx-browser-2/releases) page.

### Or create a tagged release:

```bash
git tag v2.3.1
git push --tags
```

GitHub Actions will automatically build and create a release.

## 📄 License

© 2024–2026 kriptoentuzijasti.io. All Rights Reserved.

See [LICENSE](LICENSE) for details.

## 🔗 Links

- **🌐 Website**: https://kriptoentuzijasti.io
- **📱 Mobile App**: https://github.com/ktrucek/etherx-mobile
- **💻 Desktop (this repo)**: https://github.com/ktrucek/etherx-browser-2
- **🌍 Web Version**: https://n8n.kriptoentuzijasti.io/browser.html
