#!/usr/bin/env bash
# ============================================================
#  EtherX Browser — Deploy Script (Gitea kasp.top)
#  Usage:
#    ./deploy-kasp.sh            → auto-increment patch version
#    ./deploy-kasp.sh 2.5.0      → set specific version
#    ./deploy-kasp.sh --no-push  → deploy locally only, skip git push
#
#  What it does:
#   1. Bump version in package.json, package-lock.json, src/index.html
#   2. git commit + tag vX.Y.Z
#   3. git push kasp main + push tag (triggers Gitea Actions CI build)
#   4. Copy src/index.html → n8n.kriptoentuzijasti.io/browser.html
#   5. Copy assets (icons, filters) to deploy folder
#   6. Fix ownership → kriptoen:psacln
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="/var/www/vhosts/kriptoentuzijasti.io/n8n.kriptoentuzijasti.io"
DEPLOY_OWNER="kriptoen:psacln"
NO_PUSH=false

# Gitea kasp.top config
GITEA_API="https://git.kasp.top/api/v1"
GITEA_TOKEN="251c8a3784ca62f5e41fe0490037aaec2e2c2be8"
GITEA_REPO="ktrucek/etherx-browser-2"
GITEA_ACTIONS_URL="https://git.kasp.top/ktrucek/etherx-browser-2/actions"

# ── Parse args ────────────────────────────────────────────────────────────────
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)   NO_PUSH=true ;;
    --help|-h)
      echo "Usage: ./deploy-kasp.sh [VERSION] [--no-push]"
      echo "  VERSION    e.g. 2.5.1  (default: auto-increment patch)"
      echo "  --no-push  Skip git push (local deploy only)"
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

# ── 0. Pre-flight checks ──────────────────────────────────────────────────────
info "Pre-flight checks..."

[[ -f "package.json" ]]     || error "Run from the browser project root (package.json not found)"
[[ -f "src/index.html" ]]   || error "src/index.html not found"
[[ -d "$DEPLOY_DIR" ]]      || error "Deploy directory not found: $DEPLOY_DIR"
command -v git     &>/dev/null || error "git not found"
command -v node    &>/dev/null || error "node not found"
command -v python3 &>/dev/null || error "python3 not found"
command -v curl    &>/dev/null || error "curl not found"

# Check kasp remote exists
git remote get-url kasp &>/dev/null || error "kasp remote not set. Run: git remote add kasp https://ktrucek:TOKEN@git.kasp.top/ktrucek/etherx-browser-2.git"

# Check for uncommitted changes
DIRTY=$(git status --porcelain 2>/dev/null | grep -v "^??" || true)
if [[ -n "$DIRTY" ]]; then
  warn "Uncommitted changes detected — they will be included in this commit:"
  git status --short | grep -v "^??"
fi

# ── 1. Determine version ──────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
info "Current version: ${YELLOW}$CURRENT_VERSION${NC}"

if [[ -n "$REQUESTED_VERSION" ]]; then
  NEW_VERSION="$REQUESTED_VERSION"
else
  IFS='.' read -r VMAJ VMIN VPATCH <<< "$CURRENT_VERSION"
  VPATCH=$((VPATCH + 1))
  NEW_VERSION="${VMAJ}.${VMIN}.${VPATCH}"
fi

info "New version:     ${GREEN}$NEW_VERSION${NC}"

# Confirm unless non-interactive
if [[ -t 0 ]]; then
  read -rp "$(echo -e "${YELLOW}Proceed with v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── 2. Bump version in package.json ──────────────────────────────────────────
info "Bumping package.json → $NEW_VERSION"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - <<PYEOF
import json
path = 'package.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
d['buildTime'] = '$BUILD_TIME'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  package.json updated (buildTime: $BUILD_TIME)")
PYEOF

# ── 3. Bump version in package-lock.json ─────────────────────────────────────
if [[ -f "package-lock.json" ]]; then
  info "Bumping package-lock.json → $NEW_VERSION"
  python3 - <<PYEOF
import json
path = 'package-lock.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
if 'packages' in d and '' in d['packages']:
    d['packages']['']['version'] = '$NEW_VERSION'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  package-lock.json updated")
PYEOF
fi

# ── 4. Bump version in src/index.html ────────────────────────────────────────
info "Bumping src/index.html version tag → $NEW_VERSION"
python3 - <<PYEOF
import re
path = 'src/index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
old_pattern = r'(<span id="helpVersionNum">)[^<]*(</span>)'
new_content = re.sub(old_pattern, r'\g<1>$NEW_VERSION\g<2>', content, count=1)
if new_content == content:
    print("  WARNING: helpVersionNum not found — skipping")
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("  src/index.html version updated")
PYEOF

# ── 5. Git commit + tag ───────────────────────────────────────────────────────
info "Staging files..."
git add package.json src/index.html
[[ -f "package-lock.json" ]] && git add package-lock.json
git add -u

COMMIT_MSG="v${NEW_VERSION}: deploy"
info "Committing: $COMMIT_MSG"
git commit -m "$COMMIT_MSG" || warn "Nothing new to commit"

TAG_NAME="v${NEW_VERSION}"
git tag -d "$TAG_NAME" 2>/dev/null || true
info "Tagging: $TAG_NAME"
git tag "$TAG_NAME"

# ── 6. Push to kasp.top (triggers Gitea Actions CI build) ────────────────────
if [[ "$NO_PUSH" == false ]]; then
  info "Pushing to kasp.top Gitea..."
  git push kasp main || warn "Push to kasp main failed"
  git push kasp "$TAG_NAME" || warn "Tag push to kasp failed"
  success "kasp.top push done — Gitea CI build triggered za $TAG_NAME"

  # ── Trigger Gitea workflow_dispatch za novi build ──────────────────────────
  sleep 2
  info "Triggering Gitea Actions workflow_dispatch za $TAG_NAME..."
  HTTP_CODE=$(curl -s -o /tmp/gitea_dispatch.json -w "%{http_code}" \
    -X POST "${GITEA_API}/repos/${GITEA_REPO}/actions/workflows/build.yml/dispatches" \
    -H "Authorization: token ${GITEA_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"ref\":\"main\",\"inputs\":{\"version\":\"${TAG_NAME}\",\"create_release\":\"true\"}}")

  if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
    success "Gitea workflow_dispatch triggered!"
  else
    RESP=$(cat /tmp/gitea_dispatch.json 2>/dev/null || echo "no response")
    warn "workflow_dispatch HTTP $HTTP_CODE — tag push će automatski trigernuti build: $RESP"
  fi

else
  warn "--no-push: Skipping git push"
fi

# ── 7. Deploy to n8n.kriptoentuzijasti.io ────────────────────────────────────
info "Deploying to $DEPLOY_DIR ..."

BACKUP="${DEPLOY_DIR}/browser.html.bak.$(date +%Y%m%d-%H%M%S)"
if [[ -f "${DEPLOY_DIR}/browser.html" ]]; then
  cp "${DEPLOY_DIR}/browser.html" "$BACKUP"
  info "  Backup: $BACKUP"
fi

cp "src/index.html" "${DEPLOY_DIR}/browser.html"
success "  src/index.html → ${DEPLOY_DIR}/browser.html"

if [[ -f "src/logo_novi.png" ]]; then
  cp "src/logo_novi.png" "${DEPLOY_DIR}/logo_novi.png"
  success "  src/logo_novi.png → ${DEPLOY_DIR}/logo_novi.png"
fi

if [[ -d "assets" ]]; then
  rsync -a --delete "assets/" "${DEPLOY_DIR}/electron-app/assets/" 2>/dev/null || \
    cp -r assets "${DEPLOY_DIR}/electron-app/assets"
  success "  assets/ copied"
fi

EA_SRC="${DEPLOY_DIR}/electron-app/src"
mkdir -p "$EA_SRC"
cp "main.js"    "${DEPLOY_DIR}/electron-app/main.js"
cp "preload.js" "${DEPLOY_DIR}/electron-app/preload.js"
cp "src/index.html" "${EA_SRC}/browser.html"
[[ -f "src/logo_novi.png" ]] && cp "src/logo_novi.png" "${EA_SRC}/logo_novi.png"
mkdir -p "${EA_SRC}/renderer/js" "${EA_SRC}/renderer/css"
[[ -f "src/renderer/js/browser.js" ]]   && cp "src/renderer/js/browser.js"   "${EA_SRC}/renderer/js/"
[[ -f "src/renderer/css/browser.css" ]] && cp "src/renderer/css/browser.css" "${EA_SRC}/renderer/css/"
success "  Electron app source files updated"

if [[ -f "${DEPLOY_DIR}/electron-app/package.json" ]]; then
  python3 - <<PYEOF
import json
path = '${DEPLOY_DIR}/electron-app/package.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  electron-app/package.json version updated")
PYEOF
fi

# ── 8. Fix ownership ─────────────────────────────────────────────────────────
info "Setting ownership → $DEPLOY_OWNER ..."
chown -R "$DEPLOY_OWNER" "$DEPLOY_DIR" 2>/dev/null || warn "Could not set ownership"
chmod -R 755 "$DEPLOY_DIR" 2>/dev/null || true
find "$DEPLOY_DIR" -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" -o -name "*.json" \) \
  -exec chmod 644 {} \; 2>/dev/null || true
success "Ownership set: $DEPLOY_OWNER"

chown -R "$DEPLOY_OWNER" "$REPO_DIR" 2>/dev/null || warn "Could not set repo ownership"

# ── 9. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deploy complete: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:    ${CYAN}v${NEW_VERSION}${NC}"
echo -e "  🌐 Live URL:   ${CYAN}https://n8n.kriptoentuzijasti.io/browser.html${NC}"
echo -e "  🔖 Git tag:    ${CYAN}${TAG_NAME}${NC}"
  if [[ "$NO_PUSH" == false ]]; then
  echo -e "  🚀 Gitea CI:   ${CYAN}${GITEA_ACTIONS_URL}${NC}"
fi
echo ""
echo -e "  📁 Deployed to: ${DEPLOY_DIR}/browser.html"
echo -e "  💾 Backup at:   ${BACKUP:-none}"
echo ""
