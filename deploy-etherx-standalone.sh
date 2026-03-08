#!/usr/bin/env bash
# ============================================================
#  EtherX Standalone — Deploy to github.com/ktrucek/etherx-standalone
#  Usage:
#    ./deploy-etherx-standalone.sh            → auto-increment patch version
#    ./deploy-etherx-standalone.sh 3.0.0      → set specific version
#    ./deploy-etherx-standalone.sh --no-push  → build locally, skip GitHub push
#
#  What it does:
#   1. Bump version in standalone-browser/package.json and src/index.html
#   2. git commit + tag vX.Y.Z-standalone
#   3. git push to etherx-standalone repo (separate repo for standalone builds)
#   4. Trigger GitHub Pages deployment
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STANDALONE_DIR="$REPO_DIR/standalone-browser"
STANDALONE_REPO="https://github.com/ktrucek/etherx-standalone.git"
GITHUB_TOKEN="${GITHUB_TOKEN:-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}"
STANDALONE_REMOTE="standalone"
NO_PUSH=false

# ── Parse args ────────────────────────────────────────────────────────────────
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)   NO_PUSH=true ;;
    --help|-h)
      echo "Usage: ./deploy-etherx-standalone.sh [VERSION] [--no-push]"
      echo "  VERSION   e.g. 3.0.1  (default: auto-increment patch)"
      echo "  --no-push Skip git push (local only)"
      exit 0 ;;
    *)  REQUESTED_VERSION="$arg" ;;
  esac
done

cd "$REPO_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[etherx-standalone]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ── 0. Pre-flight checks ──────────────────────────────────────────────────────
info "Pre-flight checks..."

[[ -d "$STANDALONE_DIR" ]]     || error "Standalone directory not found: $STANDALONE_DIR"
[[ -f "$STANDALONE_DIR/package.json" ]] || error "package.json not found in standalone-browser/"
[[ -f "$STANDALONE_DIR/src/index.html" ]] || error "src/index.html not found in standalone-browser/"
command -v git  &>/dev/null    || error "git not found"
command -v python3 &>/dev/null || error "python3 not found"

# Check if standalone remote exists, if not add it
if ! git remote get-url "$STANDALONE_REMOTE" &>/dev/null; then
  info "Adding remote: $STANDALONE_REMOTE → $STANDALONE_REPO"
  git remote add "$STANDALONE_REMOTE" "$STANDALONE_REPO" || error "Failed to add remote"
fi

# ── 1. Determine version ──────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('$STANDALONE_DIR/package.json'))['version'])")
info "Current standalone version: ${YELLOW}$CURRENT_VERSION${NC}"

if [[ -n "$REQUESTED_VERSION" ]]; then
  NEW_VERSION="$REQUESTED_VERSION"
else
  # Auto-increment patch: 3.0.0 → 3.0.1
  IFS='.' read -r VMAJ VMIN VPATCH <<< "$CURRENT_VERSION"
  VPATCH=$((VPATCH + 1))
  NEW_VERSION="${VMAJ}.${VMIN}.${VPATCH}"
fi

info "New version:     ${GREEN}$NEW_VERSION${NC}"

# Confirm unless non-interactive
if [[ -t 0 ]]; then
  read -rp "$(echo -e "${YELLOW}Proceed with etherx-standalone v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── 2. Bump version in standalone-browser/package.json ───────────────────────
info "Bumping standalone-browser/package.json → $NEW_VERSION"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - <<PYEOF
import json, sys
path = '$STANDALONE_DIR/package.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
d['buildTime'] = '$BUILD_TIME'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  standalone package.json updated (buildTime: $BUILD_TIME)")
PYEOF

# ── 3. Bump version in standalone-browser/src/index.html ─────────────────────
info "Bumping standalone src/index.html version tag → $NEW_VERSION"
python3 - <<PYEOF
import re
path = '$STANDALONE_DIR/src/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_pattern = r'(<span id="helpVersionNum">)[^<]*(</span>)'
new_content = re.sub(old_pattern, r'\g<1>$NEW_VERSION\g<2>', content, count=1)

if new_content == content:
    print("  WARNING: helpVersionNum not found in standalone src/index.html — skipping")
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("  standalone src/index.html version updated")
PYEOF

# ── 4. Copy standalone-browser to temporary directory for push ───────────────
info "Preparing standalone-only repository structure..."
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy all standalone-browser contents to temp
cp -r "$STANDALONE_DIR/"* "$TEMP_DIR/"
cp "$STANDALONE_DIR/.gitignore" "$TEMP_DIR/" 2>/dev/null || true

# Create README for standalone repo
cat > "$TEMP_DIR/README.md" <<'EOFREADME'
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
EOFREADME

success "Standalone structure prepared in $TEMP_DIR"

# ── 5. Initialize git in temp dir and push to standalone repo ────────────────
cd "$TEMP_DIR"

git init -b main
git add -A
git commit -m "v${NEW_VERSION}: EtherX Standalone Browser" || warn "Nothing to commit"

TAG_NAME="v${NEW_VERSION}"
git tag "$TAG_NAME"

if [[ "$NO_PUSH" == false ]]; then
  info "Pushing to $STANDALONE_REPO ..."
  # Use HTTPS with token authentication
  REPO_URL="https://${GITHUB_TOKEN}@github.com/ktrucek/etherx-standalone.git"
  git remote add origin "$REPO_URL"
  git push -f origin main || warn "Push to main failed"
  git push origin "$TAG_NAME" || warn "Tag push failed"
  success "Pushed to etherx-standalone repository"
else
  warn "--no-push: Skipping GitHub push"
fi

cd "$REPO_DIR"

# ── 6. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ EtherX Standalone Deploy: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:   ${CYAN}v${NEW_VERSION}${NC}"
echo -e "  🌐 Live URL:  ${CYAN}https://ktrucek.github.io/etherx-standalone${NC}"
echo -e "  📂 GitHub:    ${CYAN}https://github.com/ktrucek/etherx-standalone${NC}"
echo -e "  🔖 Git tag:   ${CYAN}${TAG_NAME}${NC}"
echo ""
echo -e "  ${YELLOW}ℹ️  Standalone repository updated — GitHub Pages will auto-deploy${NC}"
echo ""
