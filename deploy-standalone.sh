#!/usr/bin/env bash
# ============================================================
#  EtherX Browser — Standalone Deploy Script (GitHub)
#  Usage:
#    ./deploy-standalone.sh            → auto-increment patch version
#    ./deploy-standalone.sh 3.0.0      → set specific version
#    ./deploy-standalone.sh --no-push  → build + deploy locally, skip GitHub push
#
#  What it does:
#   1. Bump version in standalone-browser/package.json and src/index.html
#   2. git commit + tag vX.Y.Z-standalone
#   3. git push origin main + push tag (triggers GitHub Actions CI build)
#   4. Copy standalone-browser/src/index.html → n8n/browser-standalone.html
#   5. Copy assets (icons, filters) to deploy folder
#   6. Fix ownership → kriptoen:psacln
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STANDALONE_DIR="$REPO_DIR/standalone-browser"
DEPLOY_DIR="/var/www/vhosts/kriptoentuzijasti.io/n8n.kriptoentuzijasti.io"
DEPLOY_OWNER="kriptoen:psacln"
NO_PUSH=false

# ── Parse args ────────────────────────────────────────────────────────────────
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)   NO_PUSH=true ;;
    --help|-h)
      echo "Usage: ./deploy-standalone.sh [VERSION] [--no-push]"
      echo "  VERSION   e.g. 3.0.1  (default: auto-increment patch)"
      echo "  --no-push Skip git push (local deploy only)"
      exit 0 ;;
    *)  REQUESTED_VERSION="$arg" ;;
  esac
done

cd "$REPO_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[standalone]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ── 0. Pre-flight checks ──────────────────────────────────────────────────────
info "Pre-flight checks..."

[[ -d "$STANDALONE_DIR" ]]     || error "Standalone directory not found: $STANDALONE_DIR"
[[ -f "$STANDALONE_DIR/package.json" ]] || error "package.json not found in standalone-browser/"
[[ -f "$STANDALONE_DIR/src/index.html" ]] || error "src/index.html not found in standalone-browser/"
[[ -d "$DEPLOY_DIR" ]]         || error "Deploy directory not found: $DEPLOY_DIR"
command -v git  &>/dev/null    || error "git not found"
command -v node &>/dev/null    || error "node not found"
command -v python3 &>/dev/null || error "python3 not found"

# Check for uncommitted changes that aren't intentional
DIRTY=$(git status --porcelain 2>/dev/null | grep -v "^??" || true)
if [[ -n "$DIRTY" ]]; then
  warn "Uncommitted changes detected — they will be included in this commit:"
  git status --short | grep -v "^??"
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
  read -rp "$(echo -e "${YELLOW}Proceed with standalone v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── 2. Bump version in standalone-browser/package.json (+ buildTime) ─────────
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

# ── 4. Git commit + tag ───────────────────────────────────────────────────────
info "Staging standalone files..."
git add standalone-browser/package.json standalone-browser/src/index.html

# Stage any other modified tracked files
git add -u

COMMIT_MSG="v${NEW_VERSION}-standalone: deploy standalone build"
info "Committing: $COMMIT_MSG"
git commit -m "$COMMIT_MSG" || warn "Nothing new to commit (already clean)"

TAG_NAME="v${NEW_VERSION}-standalone"
# Delete local tag if it already exists (re-deploy same version)
git tag -d "$TAG_NAME" 2>/dev/null || true

info "Tagging: $TAG_NAME"
git tag "$TAG_NAME"

# ── 5. Push to GitHub (triggers CI build) ─────────────────────────────────────
if [[ "$NO_PUSH" == false ]]; then
  info "Pushing to GitHub standalone repo (triggers Actions CI build)..."
  git push standalone main || warn "Push to standalone/main failed — check remote"
  # Push only the new tag (avoid re-pushing old tags)
  git push standalone "$TAG_NAME" || warn "Tag push failed"
  success "GitHub push done — CI build triggered for $TAG_NAME"
else
  warn "--no-push: Skipping GitHub push"
fi

# ── 6. Deploy to n8n.kriptoentuzijasti.io/browser-standalone.html ────────────
info "Deploying standalone to $DEPLOY_DIR ..."

# 6a. Backup current browser-standalone.html
BACKUP="${DEPLOY_DIR}/browser-standalone.html.bak.$(date +%Y%m%d-%H%M%S)"
if [[ -f "${DEPLOY_DIR}/browser-standalone.html" ]]; then
  cp "${DEPLOY_DIR}/browser-standalone.html" "$BACKUP"
  info "  Backup: $BACKUP"
fi

# 6b. Copy the standalone HTML
cp "$STANDALONE_DIR/src/index.html" "${DEPLOY_DIR}/browser-standalone.html"
success "  standalone/src/index.html → ${DEPLOY_DIR}/browser-standalone.html"

# 6c. Copy assets directory (icons, filters, etc.)
if [[ -d "$STANDALONE_DIR/assets" ]]; then
  rsync -a --delete "$STANDALONE_DIR/assets/" "${DEPLOY_DIR}/standalone-assets/" 2>/dev/null || \
    cp -r "$STANDALONE_DIR/assets" "${DEPLOY_DIR}/standalone-assets"
  success "  standalone assets/ copied to standalone-assets/"
fi

# 6d. Copy renderer directory (settings.html, etc.)
if [[ -d "$STANDALONE_DIR/src/renderer" ]]; then
  rsync -a --delete "$STANDALONE_DIR/src/renderer/" "${DEPLOY_DIR}/renderer/" 2>/dev/null || \
    cp -r "$STANDALONE_DIR/src/renderer" "${DEPLOY_DIR}/renderer"
  success "  standalone src/renderer/ copied to renderer/"
fi

# ── 7. Fix ownership ─────────────────────────────────────────────────────────
info "Setting ownership → $DEPLOY_OWNER ..."
chown -R "$DEPLOY_OWNER" "$DEPLOY_DIR" 2>/dev/null || \
  warn "Could not set ownership (run as root or use sudo)"
chmod -R 755 "$DEPLOY_DIR" 2>/dev/null || true
# Ensure HTML/PHP/JS/CSS files are readable
find "$DEPLOY_DIR" -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" -o -name "*.json" -o -name "*.php" \) \
  -exec chmod 644 {} \; 2>/dev/null || true

success "Ownership set: $DEPLOY_OWNER"

# ── 8. Fix repo ownership ─────────────────────────────────────────────────────
info "Setting repo ownership → $DEPLOY_OWNER ..."
chown -R "$DEPLOY_OWNER" "$REPO_DIR" 2>/dev/null || warn "Could not set repo ownership"

# ── 9. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Standalone Deploy complete: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:   ${CYAN}v${NEW_VERSION}-standalone${NC}"
echo -e "  🌐 Live URL:  ${CYAN}https://n8n.kriptoentuzijasti.io/browser-standalone.html${NC}"
echo -e "  🔖 Git tag:   ${CYAN}${TAG_NAME}${NC}"
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  🚀 CI build:  ${CYAN}https://github.com/ktrucek/etherx-browser-2/actions${NC}"
fi
echo ""
echo -e "  📁 Deployed to: ${DEPLOY_DIR}/browser-standalone.html"
echo -e "  💾 Backup at:   ${BACKUP:-none}"
echo ""
echo -e "  ${YELLOW}ℹ️  Standalone build: No n8n proxy, clean browser with all features${NC}"
echo ""
