#!/usr/bin/env bash
# ============================================================
#  EtherX Standalone — Quick Deploy Script
#  Usage:
#    ./deploy.sh              → auto-increment patch version
#    ./deploy.sh 2.5.0        → set specific version
#    ./deploy.sh --no-push    → commit locally, skip GitHub push
#
#  What it does:
#   1. Bump version in package.json and src/index.html
#   2. git commit + tag vX.Y.Z
#   3. git push to origin (github.com/ktrucek/etherx-standalone)
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
info "Updating src/index.html version tag → v$NEW_VERSION"
python3 - <<PYEOF
import re
path = 'src/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_pattern = r'(<span id="helpVersionNum">)[^<]*(</span>)'
new_content = re.sub(old_pattern, r'\g<1>$NEW_VERSION\g<2>', content, count=1)

if new_content != content:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("  ✓ src/index.html version updated")
else:
    print("  ⚠ helpVersionNum not found in src/index.html — skipping")
PYEOF

# ── Git commit and tag ─────────────────────────────────────────────────────────
info "Committing changes..."
git add package.json src/index.html 2>/dev/null || true

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

# ── Push to GitHub ─────────────────────────────────────────────────────────────
if [[ "$NO_PUSH" == false ]]; then
  info "Pushing to origin..."
  
  # Check if remote exists
  if ! git remote get-url origin &>/dev/null; then
    error "No 'origin' remote configured. Run: git remote add origin <URL>"
  fi
  
  # Push main branch
  if git push origin main; then
    success "Pushed to origin/main"
  else
    warn "Push to main failed (use --no-push to skip)"
    exit 1
  fi
  
  # Push tag (force in case it exists on remote)
  if git push -f origin "$TAG_NAME"; then
    success "Pushed tag: $TAG_NAME"
  else
    warn "Tag push failed"
    exit 1
  fi
  
else
  warn "--no-push: Skipping GitHub push"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deploy Complete: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:   ${CYAN}v${NEW_VERSION}${NC}"
echo -e "  🔖 Git tag:   ${CYAN}${TAG_NAME}${NC}"
echo -e "  🌐 GitHub:    ${CYAN}https://github.com/ktrucek/etherx-standalone${NC}"
echo ""
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  ${YELLOW}🚀 GitHub Actions should trigger build now...${NC}"
  echo -e "  ${CYAN}🔗 Check: https://github.com/ktrucek/etherx-standalone/actions${NC}"
else
  echo -e "  ${YELLOW}ℹ️  Local only (use git push to deploy)${NC}"
fi
echo ""
