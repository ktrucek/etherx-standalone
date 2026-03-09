#!/usr/bin/env bash
# ============================================================
#  EtherX Standalone — Quick Deploy Script
#  Usage:
#    ./deploy.sh              → auto-increment patch version
#    ./deploy.sh 2.5.0        → set specific version
#    ./deploy.sh --no-push    → commit locally, skip push
#
#  What it does:
#   1. Bump version in package.json and src/index.html
#   2. git commit + tag vX.Y.Z
#   3. git push to GitHub (triggers GitHub Actions build)
#   4. git push to Gitea (mirror — GitHub Actions mirrors release back)
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_PUSH=false

# ── Parse args ────────────────────────────────────────────────────────────────
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)   NO_PUSH=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [VERSION] [--no-push]"
      echo "  VERSION   e.g. 2.5.0  (default: auto-increment patch)"
      echo "  --no-push Skip git push (local only)"
      exit 0 ;;
    *)  REQUESTED_VERSION="$arg" ;;
  esac
done

cd "$REPO_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────────────────────────
info "Pre-flight checks..."

[[ -f "package.json" ]]           || error "package.json not found"
[[ -f "src/index.html" ]]         || error "src/index.html not found"
command -v git  &>/dev/null       || error "git not found"
command -v python3 &>/dev/null    || error "python3 not found"

# Check git status
if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working directory has uncommitted changes!"
  git status --short
  if [[ -t 0 ]]; then
    read -rp "$(echo -e "${YELLOW}Continue anyway? [y/N] ${NC}")" CONTINUE
    [[ "$CONTINUE" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
  fi
fi

# ── Determine version ──────────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null || echo "0.0.0")
info "Current version: ${YELLOW}$CURRENT_VERSION${NC}"

if [[ -n "$REQUESTED_VERSION" ]]; then
  NEW_VERSION="$REQUESTED_VERSION"
else
  # Auto-increment patch: 2.4.28 → 2.4.29
  IFS='.' read -r VMAJ VMIN VPATCH <<< "$CURRENT_VERSION"
  VPATCH=$((VPATCH + 1))
  NEW_VERSION="${VMAJ}.${VMIN}.${VPATCH}"
fi

info "New version:     ${GREEN}$NEW_VERSION${NC}"

# Confirm unless non-interactive
if [[ -t 0 ]]; then
  read -rp "$(echo -e "${YELLOW}Deploy v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── Bump version in package.json ───────────────────────────────────────────────
info "Updating package.json → v$NEW_VERSION"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - <<PYEOF
import json
path = 'package.json'
with open(path, 'r') as f:
    data = json.load(f)
data['version'] = '$NEW_VERSION'
data['buildTime'] = '$BUILD_TIME'
with open(path, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
PYEOF
success "package.json updated (buildTime: $BUILD_TIME)"

# ── Bump version in src/index.html ─────────────────────────────────────────────
info "Updating src/index.html version tags → v$NEW_VERSION"
python3 - <<PYEOF
import re
path = 'src/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Update helpVersionNum (Help → About section)
old_pattern1 = r'(<span id="helpVersionNum">)[^<]*(</span>)'
new_content = re.sub(old_pattern1, r'\g<1>$NEW_VERSION\g<2>', content, count=1)

# Update helpVersionNum2 (Settings → Updates section)
old_pattern2 = r'(id="helpVersionNum2">)[^<]*(</span>)'
new_content = re.sub(old_pattern2, r'\g<1>$NEW_VERSION\g<2>', new_content, count=1)

if new_content != content:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("  ✓ src/index.html version updated (helpVersionNum + helpVersionNum2)")
else:
    print("  ⚠ Version tags not found in src/index.html — skipping")
PYEOF

# ── Update package-lock.json version ───────────────────────────────────────────
if [[ -f "package-lock.json" ]]; then
  info "Updating package-lock.json → v$NEW_VERSION"
  python3 - <<PYEOF
import json
path = 'package-lock.json'
try:
    with open(path, 'r') as f:
        data = json.load(f)
    
    # Update root version
    if 'version' in data:
        data['version'] = '$NEW_VERSION'
    
    # Update packages."" version (npm v7+)
    if 'packages' in data and '' in data['packages']:
        data['packages']['']['version'] = '$NEW_VERSION'
    
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    
    print("  ✓ package-lock.json version updated")
except Exception as e:
    print(f"  ⚠ Failed to update package-lock.json: {e}")
PYEOF
fi

# ── Git commit and tag ─────────────────────────────────────────────────────────
info "Committing changes..."

# Add all version-related files
git add package.json src/index.html 2>/dev/null || true
[[ -f "package-lock.json" ]] && git add package-lock.json 2>/dev/null || true
[[ -f "sw.js" ]] && git add sw.js 2>/dev/null || true

if git diff --cached --quiet; then
  warn "No changes to commit (version already set?)"
else
  git commit -m "v${NEW_VERSION}: Version bump" || warn "Commit failed"
  success "Committed v${NEW_VERSION}"
fi

TAG_NAME="v${NEW_VERSION}"

# Delete local tag if exists
if git tag -l | grep -q "^${TAG_NAME}$"; then
  info "Tag $TAG_NAME already exists locally — deleting old tag"
  git tag -d "$TAG_NAME"
fi

git tag "$TAG_NAME"
success "Tagged: $TAG_NAME"

# ── Setup remotes ──────────────────────────────────────────────────────────────
# Load tokens if .env.local exists
if [[ -f "$REPO_DIR/.env.local" ]]; then
  source "$REPO_DIR/.env.local"
fi

GITHUB_REMOTE_URL="https://${GITHUB_TOKEN_DEPLOY:-}@github.com/ktrucek/etherx-standalone.git"
GITEA_REMOTE_URL="https://${GITEA_TOKEN:-}@git.kasp.top/ktrucek/etherx-standalone.git"

# Ensure github remote
if git remote get-url github &>/dev/null; then
  git remote set-url github "$GITHUB_REMOTE_URL"
else
  git remote add github "$GITHUB_REMOTE_URL"
fi

# Ensure gitea remote (origin)
git remote set-url origin "$GITEA_REMOTE_URL"

# ── Push to both remotes ───────────────────────────────────────────────────────
if [[ "$NO_PUSH" == false ]]; then

  # 1. Push to GitHub → triggers GitHub Actions (Linux + Windows + macOS build)
  info "Pushing to GitHub (triggers build)..."
  if git push github main && git push -f github "$TAG_NAME"; then
    success "Pushed to GitHub → GitHub Actions will build + mirror to Gitea"
  else
    warn "GitHub push failed"
    exit 1
  fi

  # 2. Push to Gitea (code mirror — release arrives via GitHub Actions mirror job)
  info "Pushing code mirror to Gitea..."
  if git push origin main && git push -f origin "$TAG_NAME"; then
    success "Pushed to Gitea (code mirror)"
  else
    warn "Gitea push failed (non-fatal)"
  fi

else
  warn "--no-push: Skipping push"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deploy Complete: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:   ${CYAN}v${NEW_VERSION}${NC}"
echo -e "  🔖 Git tag:   ${CYAN}${TAG_NAME}${NC}"
echo -e "  🐙 GitHub:    ${CYAN}https://github.com/ktrucek/etherx-standalone${NC}"
echo -e "  🌐 Gitea:     ${CYAN}https://git.kasp.top/ktrucek/etherx-standalone${NC}"
echo ""
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  ${YELLOW}🚀 GitHub Actions će buildati Linux + Windows + macOS...${NC}"
  echo -e "  ${CYAN}🔗 GitHub Actions: https://github.com/ktrucek/etherx-standalone/actions${NC}"
  echo -e "  ${CYAN}🔗 Gitea Release:  https://git.kasp.top/ktrucek/etherx-standalone/releases${NC}"
  echo -e "  ${YELLOW}   (release se automatski zrcali na Gitea po završetku)${NC}"
else
  echo -e "  ${YELLOW}ℹ️  Local only (use git push to deploy)${NC}"
fi
echo ""
