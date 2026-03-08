#!/usr/bin/env bash
# ============================================================
#  EtherX Browser — Standalone Deploy Script (Gitea kasp.top)
#  Usage:
#    ./deploy-kasp-standalone.sh            → auto-increment patch version
#    ./deploy-kasp-standalone.sh 3.0.0      → set specific version
#    ./deploy-kasp-standalone.sh --no-push  → deploy locally only, skip git push
#
#  What it does:
#   1. Bump version in standalone-browser/package.json
#   2. git commit + tag vX.Y.Z-standalone
#   3. git push kasp main + push tag (triggers Gitea Actions CI build)
#   4. Copy standalone-browser/src/index.html → n8n/browser-standalone.html
#   5. Copy assets to deploy folder
#   6. Fix ownership → kriptoen:psacln
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STANDALONE_DIR="$REPO_DIR/standalone-browser"
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
      echo "Usage: ./deploy-kasp-standalone.sh [VERSION] [--no-push]"
      echo "  VERSION    e.g. 3.0.1  (default: auto-increment patch)"
      echo "  --no-push  Skip git push (local deploy only)"
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

[[ -d "$STANDALONE_DIR" ]]  || error "Standalone directory not found: $STANDALONE_DIR"
[[ -f "$STANDALONE_DIR/package.json" ]] || error "package.json not found in standalone-browser/"
[[ -f "$STANDALONE_DIR/src/index.html" ]] || error "src/index.html not found in standalone-browser/"
[[ -d "$DEPLOY_DIR" ]]      || error "Deploy directory not found: $DEPLOY_DIR"
command -v git     &>/dev/null || error "git not found"
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
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('$STANDALONE_DIR/package.json'))['version'])")
info "Current standalone version: ${YELLOW}$CURRENT_VERSION${NC}"

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
  read -rp "$(echo -e "${YELLOW}Proceed with standalone v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
fi

# ── 2. Bump version in standalone-browser/package.json ───────────────────────
info "Bumping standalone-browser/package.json → $NEW_VERSION"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
python3 - <<PYEOF
import json
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
    print("  WARNING: helpVersionNum not found — skipping")
else:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("  standalone src/index.html version updated")
PYEOF

# ── 4. Git commit + tag ───────────────────────────────────────────────────────
info "Staging standalone files..."
git add standalone-browser/package.json standalone-browser/src/index.html
git add -u

COMMIT_MSG="v${NEW_VERSION}-standalone: deploy standalone build"
info "Committing: $COMMIT_MSG"
git commit -m "$COMMIT_MSG" || warn "Nothing new to commit"

TAG_NAME="v${NEW_VERSION}-standalone"
git tag -d "$TAG_NAME" 2>/dev/null || true
info "Tagging: $TAG_NAME"
git tag "$TAG_NAME"

# ── 5. Push to kasp.top (triggers Gitea Actions CI build) ────────────────────
if [[ "$NO_PUSH" == false ]]; then
  info "Pushing to kasp.top Gitea..."
  git push kasp main || warn "Push to kasp main failed"
  git push kasp "$TAG_NAME" || warn "Tag push to kasp failed"
  success "kasp.top push done — Gitea CI build triggered for $TAG_NAME"

  # ── Trigger Gitea workflow_dispatch za novi build ──────────────────────────
  sleep 2
  info "Triggering Gitea Actions workflow_dispatch za $TAG_NAME..."
  HTTP_CODE=$(curl -s -o /tmp/gitea_dispatch.json -w "%{http_code}" \
    -X POST "${GITEA_API}/repos/${GITEA_REPO}/actions/workflows/build.yml/dispatches" \
    -H "Authorization: token ${GITEA_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"ref\":\"main\",\"inputs\":{\"version\":\"${TAG_NAME}\",\"create_release\":\"true\",\"standalone\":\"true\"}}")

  if [[ "$HTTP_CODE" == "204" || "$HTTP_CODE" == "200" ]]; then
    success "Gitea workflow_dispatch triggered!"
  else
    RESP=$(cat /tmp/gitea_dispatch.json 2>/dev/null || echo "no response")
    warn "workflow_dispatch HTTP $HTTP_CODE — tag push će automatski trigernuti build: $RESP"
  fi

else
  warn "--no-push: Skipping git push"
fi

# ── 6. Deploy to n8n.kriptoentuzijasti.io/browser-standalone.html ────────────
info "Deploying standalone to $DEPLOY_DIR ..."

BACKUP="${DEPLOY_DIR}/browser-standalone.html.bak.$(date +%Y%m%d-%H%M%S)"
if [[ -f "${DEPLOY_DIR}/browser-standalone.html" ]]; then
  cp "${DEPLOY_DIR}/browser-standalone.html" "$BACKUP"
  info "  Backup: $BACKUP"
fi

cp "$STANDALONE_DIR/src/index.html" "${DEPLOY_DIR}/browser-standalone.html"
success "  standalone/src/index.html → ${DEPLOY_DIR}/browser-standalone.html"

if [[ -d "$STANDALONE_DIR/assets" ]]; then
  rsync -a --delete "$STANDALONE_DIR/assets/" "${DEPLOY_DIR}/standalone-assets/" 2>/dev/null || \
    cp -r "$STANDALONE_DIR/assets" "${DEPLOY_DIR}/standalone-assets"
  success "  standalone assets/ copied"
fi

# ── 7. Fix ownership ─────────────────────────────────────────────────────────
info "Setting ownership → $DEPLOY_OWNER ..."
chown -R "$DEPLOY_OWNER" "$DEPLOY_DIR" 2>/dev/null || warn "Could not set ownership"
chmod -R 755 "$DEPLOY_DIR" 2>/dev/null || true
find "$DEPLOY_DIR" -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" -o -name "*.json" \) \
  -exec chmod 644 {} \; 2>/dev/null || true
success "Ownership set: $DEPLOY_OWNER"

chown -R "$DEPLOY_OWNER" "$REPO_DIR" 2>/dev/null || warn "Could not set repo ownership"

# ── 8. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Standalone Deploy complete: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Version:    ${CYAN}v${NEW_VERSION}-standalone${NC}"
echo -e "  🌐 Live URL:   ${CYAN}https://n8n.kriptoentuzijasti.io/browser-standalone.html${NC}"
echo -e "  🔖 Git tag:    ${CYAN}${TAG_NAME}${NC}"
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  🚀 Gitea CI:   ${CYAN}${GITEA_ACTIONS_URL}${NC}"
fi
echo ""
echo -e "  📁 Deployed to: ${DEPLOY_DIR}/browser-standalone.html"
echo -e "  💾 Backup at:   ${BACKUP:-none}"
echo ""
echo -e "  ${YELLOW}ℹ️  Standalone build: No n8n proxy, all functions included${NC}"
echo ""
