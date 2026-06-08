#!/usr/bin/env bash
# ============================================================
#  EtherX Standalone — Quick Deploy Script
#  Usage:
#    ./deploy.sh              → auto-increment patch version
#    ./deploy.sh 2.5.0        → set specific version
#    ./deploy.sh --no-push    → commit locally, skip push
#    ./deploy.sh --sync-browser-html → overwrite browser.html from src/index.html
#
#  What it does:
#   1. Bump version in package.json and src/index.html
#   2. git commit + tag vX.Y.Z
#   3. git push to GitHub (triggers GitHub Actions build)
#   4. Update EtherX.io download page with new version
# ============================================================

set -euo pipefail
trap 'echo -e "\033[0;31m[✗]\033[0m Deploy failed at line $LINENO" >&2' ERR

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Always run deploy from the root workspace script.
# If this script is executed inside ./etherx-standalone, hand off to ../deploy.sh.
if [[ "$(basename "$REPO_DIR")" == "etherx-standalone" && -f "$REPO_DIR/../deploy.sh" ]]; then
  echo "[deploy] Nested etherx-standalone detected — delegating to root deploy.sh"
  exec "$REPO_DIR/../deploy.sh" "$@"
fi

NO_PUSH=false
FORCE_PUSH=false
SYNC_BROWSER_HTML=false
SAVE_SECRETS=false
WRITE_ENV_LOCAL=false
ALLOW_NON_MAIN=false
SECRETS_FILE_DEFAULT="${HOME}/.config/etherx/deploy.env"
SECRETS_FILE="${DEPLOY_SECRETS_FILE:-$SECRETS_FILE_DEFAULT}"
DIRTY_WORKTREE=false
DIRTY_CONTINUE_APPROVED=false
AUTO_STASH_REF=""

# ── Helpers ───────────────────────────────────────────────────────────────────
is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

base64_noline() {
  if base64 --help 2>/dev/null | grep -q -- '-w'; then
    base64 -w0
  else
    base64 | tr -d '\n'
  fi
}

# ── Parse args ────────────────────────────────────────────────────────────────
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)   NO_PUSH=true ;;
    --force-push) FORCE_PUSH=true ;;
    --allow-non-main) ALLOW_NON_MAIN=true ;;
    --sync-browser-html) SYNC_BROWSER_HTML=true ;;
    --save-secrets) SAVE_SECRETS=true ;;
    --write-env-local) WRITE_ENV_LOCAL=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [VERSION] [--no-push] [--force-push] [--allow-non-main] [--sync-browser-html] [--save-secrets] [--write-env-local]"
      echo "  VERSION   e.g. 2.5.0  (default: auto-increment patch)"
      echo "  --no-push Skip git push (local only)"
      echo "  --force-push Use --force-with-lease when pushing main"
      echo "  --allow-non-main Allow deploy from a branch other than main"
      echo "  --sync-browser-html Force sync: src/index.html -> src/renderer/browser.html"
      echo "  --save-secrets Save current env secrets to $SECRETS_FILE_DEFAULT"
      echo "  --write-env-local Generate .env.local from loaded secrets"
      exit 0 ;;
    *)
      if [[ -n "$REQUESTED_VERSION" ]]; then
        error "Unknown argument: $arg"
      fi
      REQUESTED_VERSION="$arg"
      ;;
  esac
done

cd "$REPO_DIR"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

sync_nested_standalone_copy() {
  local nested_dir="$REPO_DIR/etherx-standalone"
  [[ -d "$nested_dir" ]] || return 0

  if ! command -v rsync &>/dev/null; then
    warn "rsync not found — skipping root→etherx-standalone sync"
    return 0
  fi

  info "Syncing root project into ./etherx-standalone before deploy..."
  rsync -ah --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='.venv/' \
    --exclude='etherx-standalone/' \
    "$REPO_DIR/" "$nested_dir/" || error "Failed to sync root→etherx-standalone"

  success "Root and ./etherx-standalone are synchronized"
}

ensure_github_remote() {
  local github_repo_url="https://github.com/ktrucek/etherx-standalone.git"
  if git remote get-url github &>/dev/null; then
    git remote set-url github "$github_repo_url"
  else
    git remote add github "$github_repo_url"
  fi
}

sync_github_main_before_deploy() {
  [[ "$NO_PUSH" == false ]] || return 0

  ensure_github_remote

  info "Fetching github/main before version bump..."
  git fetch github main:refs/remotes/github/main >/dev/null 2>&1 || error "Failed to fetch github/main"

  local behind ahead
  read -r behind ahead < <(git rev-list --left-right --count github/main...HEAD)
  behind="${behind:-0}"
  ahead="${ahead:-0}"

  if (( behind > 0 )); then
    if [[ -n "$(git status --porcelain)" ]]; then
      if [[ "$DIRTY_CONTINUE_APPROVED" != true ]]; then
        error "Local branch is behind github/main by ${behind} commit(s), but worktree is dirty. Commit/stash changes first, then rerun deploy."
      fi

      local stash_label="deploy-autostash-$(date +%s)"
      info "Dirty worktree detected and approved — auto-stashing before rebase..."
      git stash push --include-untracked -m "$stash_label" >/dev/null || error "Auto-stash before rebase failed"
      AUTO_STASH_REF="stash@{0}"
    fi

    info "Local branch is behind github/main by ${behind} commit(s) — rebasing before deploy..."
    git rebase github/main >/dev/null || error "Auto-rebase onto github/main failed"

    if [[ -n "$AUTO_STASH_REF" ]]; then
      info "Restoring auto-stashed local changes after rebase..."
      git stash pop "$AUTO_STASH_REF" >/dev/null || error "Auto-stash restore failed after rebase. Resolve conflicts and rerun deploy."
      AUTO_STASH_REF=""
    fi

    success "Rebased onto github/main"
  elif (( ahead > 0 )); then
    info "Local branch is ahead of github/main by ${ahead} commit(s)"
  else
    success "Local branch is in sync with github/main"
  fi
}

validate_etherx_download_links() {
  local page_url="https://etherx.io/browser.html"
  local release_api="https://api.github.com/repos/ktrucek/etherx-standalone/releases/tags/v${NEW_VERSION}"
  local release_api_fallback="https://api.github.com/repos/ktrucek/etherx-standalone/releases/latest"
  local page_html=""
  local release_json=""
  local latest_tag=""
  local live_broken=0
  local expected_missing=0
  local legacy_pattern_hits=0
  local -a live_urls=()
  local -a expected_names=()
  local -a expected_urls=()

  info "Post-deploy check: validating EtherX.io download links"

  page_html="$(curl -fsSL "$page_url" 2>/dev/null || true)"
  if [[ -z "$page_html" ]]; then
    warn "Could not fetch $page_url — skipping live link validation"
    return 0
  fi

  mapfile -t live_urls < <(printf '%s' "$page_html" | python3 - <<'PY'
import re
import sys

html = sys.stdin.read()
urls = sorted(set(re.findall(r'https://github\.com/ktrucek/etherx-standalone/releases/download/[^"\'\s<]+', html)))
for url in urls:
    print(url)
PY
)

  if [[ ${#live_urls[@]} -eq 0 ]]; then
    warn "No GitHub release download URLs found on $page_url"
    return 0
  fi

  for url in "${live_urls[@]}"; do
    local code
    code="$(curl -sIL "$url" | awk 'toupper($0) ~ /^HTTP\// {c=$2} END{print c}')"
    code="${code:-000}"
    if [[ "$code" =~ ^[45] ]]; then
      warn "Live link broken ($code): $url"
      ((live_broken++))
    fi

    # Detect old naming conventions still present on the page.
    if [[ "$url" == *".dmg"* ]] || [[ "$url" == *"etherx-standalone_"*"_amd64.deb"* ]] || [[ "$url" == *"EtherX.Browser."*".exe"* ]] || [[ "$url" == *"EtherX.Browser-"*".AppImage"* ]]; then
      ((legacy_pattern_hits++))
    fi
  done

  if [[ $live_broken -eq 0 ]]; then
    success "All live GitHub download links on EtherX.io are reachable"
  fi

  release_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: etherx-deploy-script' "$release_api" 2>/dev/null || true)"
  if [[ -z "$release_json" ]]; then
    warn "Release metadata for v$NEW_VERSION not found yet — trying latest release metadata"
    release_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: etherx-deploy-script' "$release_api_fallback" 2>/dev/null || true)"
  fi
  if [[ -z "$release_json" ]]; then
    warn "Could not fetch GitHub release metadata — skipping expected-link comparison"
    return 0
  fi

  latest_tag="$(printf '%s' "$release_json" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null || true)"
  mapfile -t expected_names < <(printf '%s' "$release_json" | python3 -c "import sys, json; d=json.load(sys.stdin); [print(a.get('name','')) for a in d.get('assets',[]) if a.get('name')]" 2>/dev/null || true)

  if [[ -z "$latest_tag" || ${#expected_names[@]} -eq 0 ]]; then
    warn "Latest release metadata missing tag/assets — skipping expected-link comparison"
    return 0
  fi

  if [[ "$latest_tag" != "v$NEW_VERSION" ]]; then
    warn "Latest release is $latest_tag (deploy target is v$NEW_VERSION); assets may still be building"
  fi

  for asset_name in "${expected_names[@]}"; do
    local expected_url="https://github.com/ktrucek/etherx-standalone/releases/download/$latest_tag/$asset_name"
    expected_urls+=("$expected_url")
    if ! printf '%s\n' "${live_urls[@]}" | grep -Fq "/$latest_tag/$asset_name"; then
      warn "Missing on live page: $expected_url"
      ((expected_missing++))
    fi
  done

  if [[ $expected_missing -eq 0 ]]; then
    success "Live page contains all assets from latest GitHub release ($latest_tag)"
  else
    warn "Live page is missing $expected_missing asset link(s) from latest GitHub release ($latest_tag)"
    warn "Expected download URLs for copy/paste fix:"
    for expected_url in "${expected_urls[@]}"; do
      echo "  - $expected_url"
    done
  fi

  if [[ $legacy_pattern_hits -gt 0 ]]; then
    warn "Detected $legacy_pattern_hits legacy filename pattern(s) on live page (e.g. .dmg, old .deb/.exe naming)."
    warn "Current release naming is: -linux.AppImage, -linux.deb, -mac-arm64.dmg, -mac-arm64.zip, -mac-x64.zip, -win.exe, -win.zip"
  fi
}

print_release_urls_for_tag() {
  local tag="$1"
  local release_api="https://api.github.com/repos/ktrucek/etherx-standalone/releases/tags/${tag}"
  local release_json=""
  local -a asset_urls=()

  release_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: etherx-deploy-script' "$release_api" 2>/dev/null || true)"
  if [[ -z "$release_json" ]]; then
    return 1
  fi

  mapfile -t asset_urls < <(printf '%s' "$release_json" | python3 -c "import sys, json; d=json.load(sys.stdin); [print(a.get('browser_download_url','')) for a in d.get('assets',[]) if a.get('browser_download_url')]" 2>/dev/null || true)
  if [[ ${#asset_urls[@]} -eq 0 ]]; then
    return 1
  fi

  echo -e "  📥 Download URLs (GitHub release assets):"
  for url in "${asset_urls[@]}"; do
    echo -e "     ${CYAN}${url}${NC}"
  done
  return 0
}

_load_env_file() {
  local fp="$1"
  if [[ -f "$fp" ]]; then
    # shellcheck disable=SC1090
    source "$fp"
    success "Loaded secrets: $fp"
    return 0
  fi
  return 1
}

save_deploy_secrets_file() {
  local dir
  dir="$(dirname "$SECRETS_FILE")"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  umask 077
  cat >"$SECRETS_FILE" <<EOF
# EtherX deploy secrets (auto-generated)
# DO NOT COMMIT THIS FILE
export GITHUB_TOKEN_DEPLOY="${GITHUB_TOKEN_DEPLOY:-}"
export ETHERX_API_URL="${ETHERX_API_URL:-}"
export ETHERX_API_KEY="${ETHERX_API_KEY:-}"
export ETHERX_TKAI_LICENSE_API_URL="${ETHERX_TKAI_LICENSE_API_URL:-}"
export ETHERX_TKAI_LICENSE_API_KEY="${ETHERX_TKAI_LICENSE_API_KEY:-}"
EOF
  chmod 600 "$SECRETS_FILE" 2>/dev/null || true
  success "Secrets saved to $SECRETS_FILE"
}

write_env_local_from_loaded_secrets() {
  local target="$REPO_DIR/.env.local"
  umask 077
  cat >"$target" <<EOF
# Local runtime secrets for EtherX (generated by deploy.sh)
# This file is ignored by git.

export ETHERX_API_URL="${ETHERX_API_URL:-}"
export ETHERX_API_KEY="${ETHERX_API_KEY:-}"
export ETHERX_TKAI_LICENSE_API_URL="${ETHERX_TKAI_LICENSE_API_URL:-https://kriptoentuzijasti.io/wp-json/ken-webshop/v1/license/validate}"
export ETHERX_TKAI_LICENSE_API_KEY="${ETHERX_TKAI_LICENSE_API_KEY:-}"
export GITHUB_TOKEN_DEPLOY="${GITHUB_TOKEN_DEPLOY:-}"
EOF
  chmod 600 "$target" 2>/dev/null || true
  success "Generated $target from loaded secrets"
}

# ── Secrets loading/saving ────────────────────────────────────────────────────
# Preferred source: external file outside git repo
if ! _load_env_file "$SECRETS_FILE"; then
  warn "Secrets file not found at $SECRETS_FILE"
  if _load_env_file "$REPO_DIR/.env.local"; then
    warn "Fallback: loaded secrets from .env.local"
  fi
fi

if [[ "$SAVE_SECRETS" == true ]]; then
  save_deploy_secrets_file
fi

if [[ "$WRITE_ENV_LOCAL" == true ]]; then
  write_env_local_from_loaded_secrets
fi

# ── Pre-flight checks ──────────────────────────────────────────────────────────
info "Pre-flight checks..."

[[ -f "package.json" ]]           || error "package.json not found"
[[ -f "src/index.html" ]]         || error "src/index.html not found"
command -v git  &>/dev/null       || error "git not found"
command -v python3 &>/dev/null    || error "python3 not found"
command -v curl &>/dev/null       || error "curl not found"
command -v base64 &>/dev/null      || error "base64 not found"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  error "Current directory is not a git repository"
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
[[ "$CURRENT_BRANCH" != "HEAD" ]] || error "Detached HEAD is not supported for deploy"
if [[ "$ALLOW_NON_MAIN" == false && "$CURRENT_BRANCH" != "main" ]]; then
  error "Deploy must run from main (current: $CURRENT_BRANCH). Use --allow-non-main if intentional."
fi

# Check git status
if [[ -n "$(git status --porcelain)" ]]; then
  DIRTY_WORKTREE=true
  warn "Working directory has uncommitted changes!"
  git status --short
  if [[ -t 0 ]]; then
    read -rp "$(echo -e "${YELLOW}Continue anyway? [y/N] ${NC}")" CONTINUE
    [[ "$CONTINUE" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }
    DIRTY_CONTINUE_APPROVED=true
  fi
fi

sync_github_main_before_deploy
sync_nested_standalone_copy

# ── Determine version ──────────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])" 2>/dev/null || echo "0.0.0")
info "Current version: ${YELLOW}$CURRENT_VERSION${NC}"

if [[ -n "$REQUESTED_VERSION" ]]; then
  is_semver "$REQUESTED_VERSION" || error "Invalid version format: $REQUESTED_VERSION (expected X.Y.Z)"
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

# ── Bump version in sw.js CACHE_VERSION ───────────────────────────────────────
if [[ -f "sw.js" ]]; then
  info "Updating sw.js CACHE_VERSION → etherx-v$NEW_VERSION"
  python3 - <<PYEOF
import re
path = 'sw.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
new_content = re.sub(
    r"(const CACHE_VERSION\s*=\s*')[^']*(')",
    r"\g<1>etherx-v$NEW_VERSION\g<2>",
    content, count=1
)
if new_content != content:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('  ✓ sw.js CACHE_VERSION updated to etherx-v$NEW_VERSION')
else:
    print('  ⚠ CACHE_VERSION not found in sw.js — skipping')
PYEOF
fi

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

# ── Keep browser.html in sync with src/index.html ────────────────────────────
TARGET_BROWSER_HTML="src/renderer/browser.html"
if [[ -f "$TARGET_BROWSER_HTML" ]]; then
  info "Syncing $TARGET_BROWSER_HTML ← src/index.html"
  cp -f "src/index.html" "$TARGET_BROWSER_HTML"
  success "$TARGET_BROWSER_HTML synced from src/index.html"
else
  warn "No browser.html target found at $TARGET_BROWSER_HTML — skipping sync"
fi

# Ensure nested mirror reflects all just-updated files (version, sw cache, html).
sync_nested_standalone_copy

# ── Git commit and tag ─────────────────────────────────────────────────────────
info "Committing changes..."

# Add all files (including new scripts and docs) so everything goes to GitHub
git add -A 2>/dev/null || true

# Never stage local env/secrets files
git reset -q HEAD -- \
  .env \
  .env.local \
  .env.development \
  .env.production \
  .env.test \
  .env.staging \
  .env.*.local \
  "*.env" 2>/dev/null || true

CHANGES_STAGED=true
if git diff --cached --quiet; then
  warn "No changes to commit (version already set?)"
  CHANGES_STAGED=false
else
  git commit -m "v${NEW_VERSION}: Version bump" || error "Commit failed"
  success "Committed v${NEW_VERSION}"
fi

TAG_NAME="v${NEW_VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG_NAME}" >/dev/null; then
  if [[ "$CHANGES_STAGED" == false ]]; then
    error "Tag ${TAG_NAME} already exists and there are no new changes to release"
  fi
fi

# Delete local tag if exists
if git tag -l | grep -q "^${TAG_NAME}$"; then
  info "Tag $TAG_NAME already exists locally — deleting old tag"
  git tag -d "$TAG_NAME"
fi

git tag "$TAG_NAME"
success "Tagged: $TAG_NAME"

# ── Setup remote ──────────────────────────────────────────────────────────────
# Secrets are loaded earlier from $SECRETS_FILE (preferred) or .env.local fallback.

# Token se NIKAD ne upisuje u .git/config — koristi se samo za push komandu
GITHUB_REPO_URL="https://github.com/ktrucek/etherx-standalone.git"
GITHUB_AUTH_REPO_URL=""

# Ensure github remote points to clean URL (without token)
ensure_github_remote

# ── Push to GitHub ───────────────────────────────────────────────────────
if [[ "$NO_PUSH" == false ]]; then

  # Provjera tokena (env var ili gh auth fallback)
  if [[ -z "${GITHUB_TOKEN_DEPLOY:-}" ]]; then
    if command -v gh &>/dev/null; then
      GH_TOKEN_FALLBACK="$(gh auth token 2>/dev/null || true)"
      if [[ -n "$GH_TOKEN_FALLBACK" ]]; then
        GITHUB_TOKEN_DEPLOY="$GH_TOKEN_FALLBACK"
        info "Using GitHub token from gh auth session"
      fi
    fi
  fi

  if [[ -z "${GITHUB_TOKEN_DEPLOY:-}" ]]; then
    error "GitHub token missing. Set GITHUB_TOKEN_DEPLOY or run: gh auth login && gh auth setup-git"
  fi

  # Build one-off authenticated URL (not persisted in git config).
  # Using x-access-token form works reliably for PAT/App tokens on GitHub HTTPS git endpoints.
  GITHUB_AUTH_REPO_URL="https://x-access-token:${GITHUB_TOKEN_DEPLOY}@github.com/ktrucek/etherx-standalone.git"

  # Keep git non-interactive during deploy.
  GIT_AUTH=(
    -c "core.askPass="
    -c "credential.helper="
  )

  info "Fetching github/main to refresh stale tracking ref..."
  GIT_TERMINAL_PROMPT=0 git "${GIT_AUTH[@]}" ls-remote "$GITHUB_AUTH_REPO_URL" >/dev/null || error "GitHub auth failed for deploy token (check scopes/revocation)"
  GIT_TERMINAL_PROMPT=0 git "${GIT_AUTH[@]}" fetch github main:refs/remotes/github/main >/dev/null 2>&1 || true

  read -r GITHUB_BEHIND_COUNT GITHUB_AHEAD_COUNT < <(git rev-list --left-right --count github/main...HEAD)
  GITHUB_BEHIND_COUNT="${GITHUB_BEHIND_COUNT:-0}"
  if (( GITHUB_BEHIND_COUNT > 0 )); then
    error "github/main changed during deploy and local branch is now behind by ${GITHUB_BEHIND_COUNT} commit(s). Rerun deploy to rebase first."
  fi

  info "Pushing to GitHub (triggers build)..."
  if [[ "$FORCE_PUSH" == true ]]; then
    PUSH_MAIN_CMD=(git "${GIT_AUTH[@]}" push --force-with-lease "$GITHUB_AUTH_REPO_URL" "HEAD:main")
  else
    PUSH_MAIN_CMD=(git "${GIT_AUTH[@]}" push "$GITHUB_AUTH_REPO_URL" "HEAD:main")
  fi

    if GIT_TERMINAL_PROMPT=0 "${PUSH_MAIN_CMD[@]}" && \
     GIT_TERMINAL_PROMPT=0 git "${GIT_AUTH[@]}" push "$GITHUB_AUTH_REPO_URL" "$TAG_NAME"; then
    success "Pushed to GitHub → GitHub Actions će buildati"
    
    # ── Update EtherX.io download page ─────────────────────────────────────────
    # ETHERX_API_URL and ETHERX_API_KEY must be provided via secrets file or env vars.
    if [[ -z "${ETHERX_API_URL:-}" || -z "${ETHERX_API_KEY:-}" ]]; then
      warn "ETHERX_API_URL or ETHERX_API_KEY missing — skipping website update"
      warn "Set them in $SECRETS_FILE or export env vars to enable auto-update:"
      warn "  ETHERX_API_URL=\"https://etherx.io/api/update_version.php\""
      warn "  ETHERX_API_KEY=\"your_secret_key\""
    else
      info "Updating EtherX.io download page with new version..."
      sleep 3

      UPDATE_RESPONSE=$(curl -s -X POST "$ETHERX_API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"version\": \"$NEW_VERSION\", \"api_key\": \"$ETHERX_API_KEY\"}" \
        --max-time 30 || echo '{"success": false, "message": "Curl failed"}')

      if echo "$UPDATE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
        success "EtherX.io download page updated to v$NEW_VERSION"
      else
        warn "Failed to update EtherX.io page: $UPDATE_RESPONSE"
        warn "You can manually update at: https://etherx.io/download_stats.php"
      fi
    fi

    # ── Ažuriraj api.kriptoentuzijasti.io/version ──────────────────────────
    KRIPTOAPI_URL="${ETHERX_KRIPTO_API_URL:-https://api.kriptoentuzijasti.io/version}"
    KRIPTOAPI_KEY="${ETHERX_KRIPTO_API_KEY:-${ETHERX_API_KEY:-}}"
    if [[ -z "$KRIPTOAPI_KEY" ]]; then
      warn "ETHERX_KRIPTO_API_KEY / ETHERX_API_KEY missing — skipping kriptoentuzijasti.io update"
    else
      info "Updating api.kriptoentuzijasti.io version endpoint → v$NEW_VERSION"
      KRIPTOAPI_RESPONSE=$(curl -s -X POST "$KRIPTOAPI_URL" \
        -H "Content-Type: application/json" \
        -d "{\"version\": \"$NEW_VERSION\", \"api_key\": \"${KRIPTOAPI_KEY}\"}" \
        --max-time 15 || echo '{"ok":false,"error":"Curl failed"}')

      if echo "$KRIPTOAPI_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('ok') else 1)" 2>/dev/null; then
        success "api.kriptoentuzijasti.io/version updated to v$NEW_VERSION"
      else
        warn "Failed to update kriptoentuzijasti.io endpoint: $KRIPTOAPI_RESPONSE"
      fi
    fi

    validate_etherx_download_links
    
  else
    warn "GitHub push failed"
    exit 1
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
echo -e "  🌐 EtherX.io: ${CYAN}https://etherx.io/browser.html${NC}"
echo ""
if ! print_release_urls_for_tag "v${NEW_VERSION}"; then
  echo -e "  📥 Download URLs (predicted, čekaju da Actions dovrši build):"
  echo -e "     🍎 macOS arm64 DMG: ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-mac-arm64.dmg${NC}"
  echo -e "     🍎 macOS arm64 ZIP: ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-mac-arm64.zip${NC}"
  echo -e "     🍎 macOS x64 ZIP:   ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-mac-x64.zip${NC}"
  echo -e "     🪟 Windows EXE:     ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-win.exe${NC}"
  echo -e "     🪟 Windows ZIP:     ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-win.zip${NC}"
  echo -e "     🐧 Linux AppImage:  ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-linux.AppImage${NC}"
  echo -e "     🐧 Linux DEB:       ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/download/v${NEW_VERSION}/EtherX.Browser-${NEW_VERSION}-linux.deb${NC}"
fi
echo -e "  🏷️ Ostale verzije:      ${CYAN}https://github.com/ktrucek/etherx-standalone/releases/tag/vX.Y.Z${NC}"
echo ""
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  ${YELLOW}🚀 GitHub Actions će buildati Linux + Windows + macOS...${NC}"
  echo -e "  ${CYAN}🔗 Actions: https://github.com/ktrucek/etherx-standalone/actions${NC}"
  echo -e "  ${CYAN}🔗 Release: https://github.com/ktrucek/etherx-standalone/releases${NC}"
  echo -e "  ${CYAN}🔗 Downloads: https://etherx.io/browser.html${NC}"
  echo -e "  ${CYAN}🔗 Stats: https://etherx.io/download_stats.php${NC}"
else
  echo -e "  ${YELLOW}ℹ️  Local only (use git push to deploy)${NC}"
fi
echo ""
