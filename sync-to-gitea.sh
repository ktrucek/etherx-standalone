#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  sync-to-gitea.sh
#  Povlači sve s GitHub-a (ktrucek/etherx-standalone) i pusha na Gitea
#  (git.kasp.top/ktrucek/etherx-standalone)
#
#  Korištenje:
#    bash sync-to-gitea.sh                  # sync trenutne grane
#    bash sync-to-gitea.sh --tags           # sync + svi tagovi
#    GITHUB_TOKEN=xxx bash sync-to-gitea.sh # s tokenom (privatni repo)
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Konfiguracija ────────────────────────────────────────────────────────────
GITHUB_REPO="ktrucek/etherx-standalone"
GITEA_REMOTE="https://git.kasp.top/ktrucek/etherx-standalone.git"
BRANCH="main"

# GitHub token — čita se iz env varijable, NIKAD se ne stavlja direktno u skriptu
# Postavi prije poziva: export GITHUB_TOKEN="github_pat_..."
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# ── Boje za output ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}ℹ  $*${NC}"; }
success() { echo -e "${GREEN}✅ $*${NC}"; }
warn()    { echo -e "${YELLOW}⚠  $*${NC}"; }
error()   { echo -e "${RED}❌ $*${NC}"; exit 1; }

# ── Provjera alata ───────────────────────────────────────────────────────────
command -v git  >/dev/null 2>&1 || error "git nije instaliran."
command -v curl >/dev/null 2>&1 || error "curl nije instaliran."

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       EtherX — GitHub → Gitea sync skripta          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Pripremi GitHub URL s tokenom (ako postoji) ──────────────────────────────
if [[ -n "$GITHUB_TOKEN" ]]; then
  GITHUB_URL="https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git"
  info "Koristi GitHub token za autentifikaciju."
else
  GITHUB_URL="https://github.com/${GITHUB_REPO}.git"
  info "Bez GitHub tokena (javni repo)."
fi

# ── Gitea credentials ────────────────────────────────────────────────────────
# Postavi GITEA_TOKEN u environment ili će pitati za lozinku
GITEA_TOKEN="${GITEA_TOKEN:-}"
if [[ -n "$GITEA_TOKEN" ]]; then
  GITEA_HOST=$(echo "$GITEA_REMOTE" | sed 's|https://||' | cut -d'/' -f1)
  GITEA_PATH=$(echo "$GITEA_REMOTE" | sed "s|https://${GITEA_HOST}/||")
  GITEA_PUSH_URL="https://${GITEA_TOKEN}@${GITEA_HOST}/${GITEA_PATH}"
else
  GITEA_PUSH_URL="$GITEA_REMOTE"
  warn "GITEA_TOKEN nije postavljen — git će tražiti lozinku pri pushu."
  warn "Postavi: export GITEA_TOKEN=\"tvoj-gitea-token\""
fi

# ── Privremeni direktorij ─────────────────────────────────────────────────────
TMPDIR_SYNC=$(mktemp -d)
trap 'rm -rf "$TMPDIR_SYNC"' EXIT
info "Radni direktorij: $TMPDIR_SYNC"

# ── 1. Clone s GitHub-a ──────────────────────────────────────────────────────
echo ""
info "Povlačim s GitHub-a: github.com/${GITHUB_REPO} ..."
git clone --mirror "$GITHUB_URL" "$TMPDIR_SYNC/github-mirror" 2>&1 | \
  grep -v "^$" | sed 's/^/   /' || error "Kloniranje s GitHub-a nije uspjelo."
success "GitHub clone završen."

# ── 2. Push na Gitea ─────────────────────────────────────────────────────────
echo ""
info "Pushamo na Gitea: git.kasp.top/ktrucek/etherx-standalone ..."
cd "$TMPDIR_SYNC/github-mirror"

# Push sve grane
git push --mirror "$GITEA_PUSH_URL" 2>&1 | sed 's/^/   /' || {
  warn "Mirror push nije uspio — probavam push samo grane '$BRANCH' i tagova..."
  git push "$GITEA_PUSH_URL" "refs/heads/${BRANCH}:refs/heads/${BRANCH}" --force 2>&1 | sed 's/^/   /'
  git push "$GITEA_PUSH_URL" --tags --force 2>&1 | sed 's/^/   /'
}

# ── 3. Provjeri zadnji tag ────────────────────────────────────────────────────
echo ""
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "nema tagova")
LATEST_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "n/a")
success "Sync završen!"
echo ""
echo -e "   ${GREEN}GitHub  →  ${CYAN}github.com/${GITHUB_REPO}${NC}"
echo -e "   ${GREEN}Gitea   →  ${CYAN}git.kasp.top/ktrucek/etherx-standalone${NC}"
echo -e "   ${GREEN}Grana   →  ${CYAN}${BRANCH}${NC}"
echo -e "   ${GREEN}Tag     →  ${CYAN}${LATEST_TAG}${NC}"
echo -e "   ${GREEN}Commit  →  ${CYAN}${LATEST_COMMIT}${NC}"
echo ""
