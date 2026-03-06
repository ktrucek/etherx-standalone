#!/bin/bash

################################################################################
# EtherX Browser - Comprehensive Download & Build Readiness Check
# Potpuna analiza spremnosti za build nakon višestrukih download pokušaja
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║         EtherX Browser - Build Readiness Assessment               ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${CYAN}Assessment Date:${NC} $(date)"
echo -e "${CYAN}Assessment Purpose:${NC} Determine if we can proceed to Phase 1.4 (Build)"
echo ""

if [[ ! -d "$CHROMIUM_DIR" ]]; then
    echo -e "${RED}❌ FATAL: Chromium directory not found!${NC}"
    exit 1
fi

cd "$CHROMIUM_DIR"

# 1. Repository Count
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}1. SOURCE CODE REPOSITORIES${NC}"
echo "═══════════════════════════════════════════════════════════════════"

REPO_COUNT=$(find . -name ".git" -type d 2>/dev/null | wc -l)
echo -e "${CYAN}   Repositories found:${NC} $REPO_COUNT"

if [[ $REPO_COUNT -ge 227 ]]; then
    echo -e "${GREEN}   ✅ EXCELLENT: Full repository count ($REPO_COUNT/227)${NC}"
    REPO_STATUS="COMPLETE"
elif [[ $REPO_COUNT -ge 200 ]]; then
    echo -e "${GREEN}   ✅ GOOD: Near complete ($REPO_COUNT/227 = 88%+)${NC}"
    REPO_STATUS="NEARLY_COMPLETE"
elif [[ $REPO_COUNT -ge 144 ]]; then
    echo -e "${YELLOW}   ⚠️  PARTIAL: Basic repos present ($REPO_COUNT/227 = 63%)${NC}"
    echo -e "${YELLOW}   Note: May be sufficient for basic build${NC}"
    REPO_STATUS="PARTIAL"
else
    echo -e "${RED}   ❌ INSUFFICIENT: Too few repos ($REPO_COUNT/227)${NC}"
    REPO_STATUS="INSUFFICIENT"
fi

# 2. Critical Build Tools
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}2. CRITICAL BUILD TOOLS${NC}"
echo "═══════════════════════════════════════════════════════════════════"

TOOLS_OK=0
TOOLS_MISSING=0

# Check GN
if [[ -x "src/buildtools/linux64/gn" ]]; then
    GN_VERSION=$(src/buildtools/linux64/gn --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}   ✅ GN Build System:${NC} Present ($GN_VERSION)"
    ((TOOLS_OK++))
else
    echo -e "${RED}   ❌ GN Build System:${NC} MISSING (CRITICAL)"
    ((TOOLS_MISSING++))
fi

# Check Ninja
if command -v ninja &> /dev/null; then
    NINJA_VERSION=$(ninja --version 2>/dev/null)
    echo -e "${GREEN}   ✅ Ninja Build:${NC} $NINJA_VERSION"
    ((TOOLS_OK++))
else
    echo -e "${RED}   ❌ Ninja Build:${NC} MISSING (CRITICAL)"
    ((TOOLS_MISSING++))
fi

# Check Python3
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}   ✅ Python3:${NC} $PYTHON_VERSION"
    ((TOOLS_OK++))
else
    echo -e "${RED}   ❌ Python3:${NC} MISSING (CRITICAL)"
    ((TOOLS_MISSING++))
fi

# Check Git
if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version)
    echo -e "${GREEN}   ✅ Git:${NC} $GIT_VERSION"
    ((TOOLS_OK++))
else
    echo -e "${RED}   ❌ Git:${NC} MISSING (CRITICAL)"
    ((TOOLS_MISSING++))
fi

# 3. Optional Build Tools
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}3. OPTIONAL BUILD TOOLS${NC}"
echo "═══════════════════════════════════════════════════════════════════"

# Check clang-format
if [[ -x "src/buildtools/linux64/clang-format" ]]; then
    echo -e "${GREEN}   ✅ clang-format:${NC} Present"
else
    echo -e "${YELLOW}   ⚠️  clang-format:${NC} Missing (optional, for code formatting)"
fi

# Check clang
if [[ -d "src/third_party/llvm-build/Release+Asserts/bin" ]]; then
    echo -e "${GREEN}   ✅ Clang Compiler:${NC} Present"
else
    echo -e "${YELLOW}   ⚠️  Clang Compiler:${NC} Missing (may need download)"
fi

# 4. Source Code Size
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}4. SOURCE CODE SIZE & STRUCTURE${NC}"
echo "═══════════════════════════════════════════════════════════════════"

TOTAL_SIZE=$(du -sh . 2>/dev/null | cut -f1)
echo -e "${CYAN}   Total size:${NC} $TOTAL_SIZE"

if [[ -d "src" ]]; then
    SRC_SIZE=$(du -sh src 2>/dev/null | cut -f1)
    echo -e "${GREEN}   ✅ src/ directory:${NC} $SRC_SIZE"
else
    echo -e "${RED}   ❌ src/ directory:${NC} MISSING (CRITICAL)"
fi

if [[ -d "src/third_party" ]]; then
    THIRD_PARTY_SIZE=$(du -sh src/third_party 2>/dev/null | cut -f1)
    THIRD_PARTY_COUNT=$(ls -1 src/third_party 2>/dev/null | wc -l)
    echo -e "${GREEN}   ✅ third_party/:${NC} $THIRD_PARTY_SIZE ($THIRD_PARTY_COUNT libraries)"
else
    echo -e "${RED}   ❌ third_party/:${NC} MISSING"
fi

# 5. Key Components Check
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}5. KEY CHROMIUM COMPONENTS${NC}"
echo "═══════════════════════════════════════════════════════════════════"

COMPONENTS=("base" "content" "ui" "net" "third_party/blink" "v8")
COMPONENTS_OK=0

for comp in "${COMPONENTS[@]}"; do
    if [[ -d "src/$comp" ]]; then
        echo -e "${GREEN}   ✅ $comp${NC}"
        ((COMPONENTS_OK++))
    else
        echo -e "${RED}   ❌ $comp${NC}"
    fi
done

# 6. Build Configuration Files
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}6. BUILD CONFIGURATION FILES${NC}"
echo "═══════════════════════════════════════════════════════════════════"

if [[ -f "src/BUILD.gn" ]]; then
    echo -e "${GREEN}   ✅ BUILD.gn:${NC} Present"
else
    echo -e "${RED}   ❌ BUILD.gn:${NC} Missing"
fi

if [[ -f "src/.gn" ]]; then
    echo -e "${GREEN}   ✅ .gn:${NC} Present"
else
    echo -e "${RED}   ❌ .gn:${NC} Missing"
fi

if [[ -f ".gclient" ]]; then
    echo -e "${GREEN}   ✅ .gclient:${NC} Present"
else
    echo -e "${YELLOW}   ⚠️  .gclient:${NC} Missing (should exist in parent dir)"
fi

# 7. System Resources
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${BLUE}7. SYSTEM RESOURCES${NC}"
echo "═══════════════════════════════════════════════════════════════════"

CPU_CORES=$(nproc)
echo -e "${CYAN}   CPU Cores:${NC} $CPU_CORES"
if [[ $CPU_CORES -ge 8 ]]; then
    echo -e "${GREEN}   ✅ Sufficient for parallel build${NC}"
else
    echo -e "${YELLOW}   ⚠️  Limited cores (build will be slower)${NC}"
fi

TOTAL_RAM=$(free -h | awk '/^Mem:/{print $2}')
echo -e "${CYAN}   Total RAM:${NC} $TOTAL_RAM"

AVAIL_RAM=$(free -h | awk '/^Mem:/{print $7}')
echo -e "${CYAN}   Available RAM:${NC} $AVAIL_RAM"

DISK_FREE=$(df -h . | awk 'NR==2 {print $4}')
echo -e "${CYAN}   Disk Free:${NC} $DISK_FREE"

# 8. Final Assessment
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${PURPLE}8. FINAL ASSESSMENT${NC}"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

BUILD_READY=false

if [[ $TOOLS_OK -eq 4 ]] && [[ $COMPONENTS_OK -ge 5 ]] && [[ $REPO_COUNT -ge 100 ]]; then
    BUILD_READY=true
fi

if [[ $BUILD_READY == true ]]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ BUILD READINESS: READY TO PROCEED${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}Summary:${NC}"
    echo -e "  • Build tools: ${GREEN}$TOOLS_OK/4 present${NC}"
    echo -e "  • Core components: ${GREEN}$COMPONENTS_OK/6 present${NC}"
    echo -e "  • Repositories: ${CYAN}$REPO_COUNT${NC} ($REPO_STATUS)"
    echo -e "  • Total size: ${CYAN}$TOTAL_SIZE${NC}"
    echo ""
    echo -e "${YELLOW}📋 RECOMMENDATION:${NC}"
    echo -e "  ${GREEN}✅ Proceed to Phase 1.4 - Chromium Build${NC}"
    echo ""
    echo -e "  ${CYAN}Next Steps:${NC}"
    echo -e "    1. cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser"
    echo -e "    2. ./scripts/phase1/04_chromium_build.sh"
    echo ""
    echo -e "  ${YELLOW}Note:${NC} Some optional tools are missing (like clang-format)"
    echo -e "  but these are not critical for the initial build."
    echo -e "  The build process may download additional tools as needed."
    
elif [[ $TOOLS_MISSING -gt 0 ]]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ BUILD READINESS: NOT READY (Missing Critical Tools)${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}📋 RECOMMENDATION:${NC}"
    echo -e "  ${RED}❌ Install missing tools first${NC}"
    echo -e "  Run: ./scripts/phase1/02_environment_setup.sh"
    
elif [[ $REPO_COUNT -lt 100 ]]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ BUILD READINESS: NOT READY (Insufficient Source Code)${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}📋 RECOMMENDATION:${NC}"
    echo -e "  ${RED}❌ Re-run download: gclient sync --with_branch_heads --with_tags${NC}"
    
else
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  BUILD READINESS: UNCERTAIN${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}📋 RECOMMENDATION:${NC}"
    echo -e "  ${CYAN}Try building anyway - it may work or will tell us what's missing${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo ""
