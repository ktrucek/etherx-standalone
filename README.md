# EtherX Mobile Browser

React Native mobile browser app for iOS and Android with Web3 wallet integration.

## 🚀 Features

- ✅ Full web browser with tabs
- ✅ Web3/Ethereum provider injection
- ✅ localStorage bridge to AsyncStorage
- ✅ Native navigation (back/forward/reload)
- ✅ Multi-tab support
- ✅ HTTPS support
- ✅ Mobile-optimized UI

## 📱 Installation

### Prerequisites

- Node.js 18+
- React Native CLI
- For iOS: Xcode 14+, CocoaPods
- For Android: Android Studio, JDK 17+

### Setup

```bash
# Install dependencies
npm install

# iOS setup
cd ios && pod install && cd ..

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## 🔧 Build for Production

### Android APK

```bash
npm run build:android
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### iOS IPA

```bash
npm run build:ios
# Archive via Xcode → Product → Archive
```

## 📦 App Structure

```
EtherXMobile/
├── App.tsx                 # Main browser component
├── package.json
├── android/                # Android native code
├── ios/                    # iOS native code
└── README.md
```

## 🌐 Web3 Integration

The app injects `window.ethereum` provider into webpages:

```javascript
// Auto-injected in every webpage
window.ethereum.request({
  method: "eth_requestAccounts",
});
```

## 📝 License

MIT © kriptoentuzijasti.io
