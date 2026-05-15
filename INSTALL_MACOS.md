# 🍎 macOS Installation Guide - EtherX Browser

## Problem: "EtherX Browser is damaged and can't be opened"

This is a **macOS Gatekeeper security message**, not an actual problem with the app. macOS blocks apps that aren't notarized by Apple.

---

## ✅ Solution 1: Remove Quarantine Flag (Recommended)

**Open Terminal and run:**

```bash
xattr -cr "/Applications/EtherX Browser.app"
```

Or if you haven't moved it to Applications yet:

```bash
xattr -cr ~/Downloads/EtherX\ Browser.app
```

Then open the app normally. ✅

---

## ✅ Solution 2: Right-Click Open (First Launch Only)

1. Right-click (or Ctrl+click) on **EtherX Browser.app**
2. Select **"Open"** from the menu
3. Click **"Open"** in the dialog that appears
4. The app will open and remember this choice

---

## ✅ Solution 3: System Settings Override

1. Try to open **EtherX Browser** normally (it will be blocked)
2. Go to **System Settings** → **Privacy & Security**
3. Scroll down and click **"Open Anyway"** next to the EtherX Browser message
4. Confirm by clicking **"Open"**

---

## Why This Happens

- EtherX Browser is an open-source project and not notarized with Apple ($99/year fee)
- The app is **100% safe** - you can review the source code on GitHub
- macOS blocks all unsigned apps by default for security

---

## Verify App Integrity (Optional)

Check the app signature:

```bash
codesign -dv --verbose=4 "/Applications/EtherX Browser.app"
```

Verify it matches the GitHub release checksums at:  
https://github.com/ktrucek/etherx-standalone/releases

---

## Still Having Issues?

- Make sure you downloaded from the official source: https://etherx.io/browser.html
- Try redownloading (sometimes download corruption causes real damage)
- Check GitHub Issues: https://github.com/ktrucek/etherx-standalone/issues

---

**Once opened successfully, macOS will remember and allow future launches! 🎉**
