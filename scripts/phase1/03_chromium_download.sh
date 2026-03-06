#!/bin/bash

################################################################################
# EtherX Browser - Phase 1.3: Download Chromium Source Code
#
# This script downloads the Chromium source code (~30GB) using depot_tools.
# Expected time: 1-3 hours depending on internet connection.
################################################################################

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${MAGENTA}[STEP]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load configuration
source "$PROJECT_ROOT/CONFIG.sh"

LOG_FILE="$PROJECT_ROOT/logs/phase1_03_chromium_download.log"
CHROMIUM_DIR="$CHROMIUM_ROOT"
DEPOT_TOOLS_DIR="$DEPOT_TOOLS_ROOT"

mkdir -p "$PROJECT_ROOT/logs"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log_info "============================================"
log_info "EtherX Browser - Chromium Source Download"
log_info "============================================"
log_info "Started at: $(date)"
echo ""

################################################################################
# Verify depot_tools
################################################################################
verify_depot_tools() {
    log_step "Verifying depot_tools installation..."
    
    if ! command -v gclient &> /dev/null; then
        log_error "depot_tools not found in PATH"
        log_error "Please run: ./scripts/phase1/02_environment_setup.sh first"
        log_error "Or add depot_tools to PATH: export PATH=\"\$PATH:$DEPOT_TOOLS_DIR\""
        exit 1
    fi
    
    log_success "depot_tools found: $(which gclient)"
    gclient --version
    echo ""
}

################################################################################
# Check disk space
################################################################################
check_disk_space() {
    log_step "Checking available disk space..."
    
    available_space=$(df -BG "$HOME" | awk 'NR==2 {print $4}' | sed 's/G//')
    
    log_info "Available space: ${available_space}GB"
    
    if [[ $available_space -lt 100 ]]; then
        log_error "Insufficient disk space!"
        log_error "Need: 100GB minimum"
        log_error "Available: ${available_space}GB"
        log_error "Please free up space before continuing."
        exit 1
    fi
    
    log_success "Sufficient disk space available"
    echo ""
}

################################################################################
# Create working directory
################################################################################
create_working_directory() {
    log_step "Creating working directory..."
    
    if [[ -d "$CHROMIUM_DIR" ]]; then
        log_warning "Chromium directory already exists: $CHROMIUM_DIR"
        read -p "Continue and use existing directory? (y/n): " choice
        if [[ "$choice" != "y" ]]; then
            log_info "Aborting..."
            exit 0
        fi
    else
        mkdir -p "$CHROMIUM_DIR"
        log_success "Created directory: $CHROMIUM_DIR"
    fi
    
    cd "$CHROMIUM_DIR"
    log_info "Working directory: $(pwd)"
    echo ""
}

################################################################################
# Fetch Chromium source
################################################################################
fetch_chromium_source() {
    log_step "Fetching Chromium source code..."
    log_warning "This will download ~30GB and may take 1-3 hours!"
    log_info "Started at: $(date)"
    echo ""
    
    # Check if already fetched
    if [[ -d "$CHROMIUM_DIR/src" ]]; then
        log_warning "Source directory already exists: $CHROMIUM_DIR/src"
        read -p "Skip fetch and sync existing? (y/n): " choice
        if [[ "$choice" == "y" ]]; then
            log_info "Skipping fetch, will sync existing source..."
            return 0
        fi
    fi
    
    cd "$CHROMIUM_DIR"
    
    # Fetch Chromium (without hooks initially for speed)
    log_info "Running: fetch --nohooks chromium"
    log_info "Progress will be shown below..."
    echo ""
    
    if fetch --nohooks chromium; then
        log_success "Chromium source fetched successfully"
    else
        log_error "Failed to fetch Chromium source"
        log_error "Check your internet connection and try again"
        exit 1
    fi
    
    log_info "Fetch completed at: $(date)"
    echo ""
}

################################################################################
# Checkout stable version
################################################################################
checkout_stable_version() {
    log_step "Checking out stable Chromium version..."
    
    cd "$CHROMIUM_DIR/src"
    
    # Fetch all tags
    log_info "Fetching tags..."
    git fetch --tags
    
    # Get latest stable version
    # You can change this to a specific version if needed
    STABLE_VERSION="120.0.6099.109"
    
    log_info "Target version: $STABLE_VERSION"
    
    # Check if branch already exists
    if git rev-parse --verify "etherx-browser" &> /dev/null; then
        log_warning "Branch 'etherx-browser' already exists"
        git checkout etherx-browser
    else
        log_info "Creating branch 'etherx-browser' from tag $STABLE_VERSION"
        git checkout -b etherx-browser "tags/$STABLE_VERSION"
    fi
    
    log_success "Checked out version: $STABLE_VERSION"
    echo ""
}

################################################################################
# Sync dependencies
################################################################################
sync_dependencies() {
    log_step "Syncing dependencies..."
    log_info "This will download additional dependencies..."
    echo ""
    
    cd "$CHROMIUM_DIR/src"
    
    log_info "Running: gclient sync --with_branch_heads --with_tags"
    log_warning "This may take 30-60 minutes..."
    echo ""
    
    if gclient sync --with_branch_heads --with_tags; then
        log_success "Dependencies synced successfully"
    else
        log_error "Failed to sync dependencies"
        log_error "Try running manually: cd $CHROMIUM_DIR/src && gclient sync"
        exit 1
    fi
    
    log_info "Sync completed at: $(date)"
    echo ""
}

################################################################################
# Install build dependencies (Linux)
################################################################################
install_build_dependencies() {
    log_step "Installing build dependencies..."
    
    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        log_info "Skipping (not Linux)"
        return 0
    fi
    
    cd "$CHROMIUM_DIR/src"
    
    if [[ -f "build/install-build-deps.sh" ]]; then
        log_info "Running: build/install-build-deps.sh"
        log_warning "This will install system packages and may require sudo password"
        echo ""
        
        sudo ./build/install-build-deps.sh --no-prompt
        
        log_success "Build dependencies installed"
    else
        log_warning "install-build-deps.sh not found"
    fi
    
    echo ""
}

################################################################################
# Create repository info
################################################################################
create_repository_info() {
    log_step "Creating repository information..."
    
    cd "$CHROMIUM_DIR/src"
    
    REPO_INFO_FILE="$PROJECT_ROOT/CHROMIUM_REPO_INFO.md"
    
    cat > "$REPO_INFO_FILE" << EOF
# Chromium Repository Information

**Generated:** $(date)
**Location:** $CHROMIUM_DIR/src

## Version Information

\`\`\`
Branch: $(git rev-parse --abbrev-ref HEAD)
Commit: $(git rev-parse HEAD)
Tag: $(git describe --tags)
\`\`\`

## Repository Size

\`\`\`
Source directory: $(du -sh "$CHROMIUM_DIR/src" | cut -f1)
Total Chromium: $(du -sh "$CHROMIUM_DIR" | cut -f1)
\`\`\`

## Important Directories

\`\`\`
$CHROMIUM_DIR/src/
├── chrome/              - Chrome browser-specific code
├── content/             - Content API (core)
├── components/          - Shared components
├── ui/                  - UI framework
├── third_party/
│   ├── blink/          - Rendering engine
│   └── WebKit/         - (legacy)
├── v8/                  - JavaScript engine
├── net/                 - Network stack
├── base/                - Base libraries
├── build/               - Build configuration
├── tools/               - Development tools
└── out/                 - Build output (created during build)
\`\`\`

## Key Files

- **GN Build:** \`BUILD.gn\` files throughout the tree
- **Build Args:** Will be at \`out/Default/args.gn\`
- **Build Script:** \`build/install-build-deps.sh\`
- **Git Config:** \`.git/config\`

## Git Branches

\`\`\`
$(git branch -a | head -n 20)
\`\`\`

## Recent Commits (Last 5)

\`\`\`
$(git log --oneline -5)
\`\`\`

## Next Steps

1. ✅ Source code downloaded
2. → Run Phase 1.4: \`scripts/phase1/04_chromium_build.sh\`
3. → Configure build options in \`out/Default/args.gn\`
4. → Build content_shell or full Chrome

## Updating Chromium

To update to a newer version:

\`\`\`bash
cd $CHROMIUM_DIR/src
git fetch --tags
git checkout tags/<new-version>
gclient sync
\`\`\`

## Disk Usage

Monitor disk usage:
\`\`\`bash
du -sh $CHROMIUM_DIR/*
\`\`\`

Clean build artifacts:
\`\`\`bash
rm -rf out/
\`\`\`

## Resources

- **Official Docs:** https://chromium.googlesource.com/chromium/src/+/main/docs/
- **Build Guide:** https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md
- **GN Reference:** https://gn.googlesource.com/gn/+/main/docs/reference.md
EOF

    log_success "Repository info saved: $REPO_INFO_FILE"
    echo ""
}

################################################################################
# Explore repository structure
################################################################################
explore_repository() {
    log_step "Exploring repository structure..."
    
    cd "$CHROMIUM_DIR/src"
    
    log_info "Top-level directories:"
    ls -d */ | head -n 20
    echo ""
    
    log_info "Key files:"
    ls -lh | grep -E "BUILD|README|LICENSE" || true
    echo ""
    
    log_info "Content API structure:"
    ls -d content/*/ 2>/dev/null | head -n 10 || log_warning "Content directory structure may differ"
    echo ""
}

################################################################################
# Generate summary
################################################################################
generate_summary() {
    log_step "Generating download summary..."
    
    SUMMARY_FILE="$PROJECT_ROOT/CHROMIUM_DOWNLOAD_SUMMARY.md"
    
    cd "$CHROMIUM_DIR/src"
    
    cat > "$SUMMARY_FILE" << EOF
# Chromium Source Download Summary

**Completed:** $(date)
**Phase:** 1.3 - Chromium Source Download
**Status:** ✅ Complete

## What Was Downloaded

✅ Chromium source code
✅ Third-party dependencies
✅ Build tools and scripts
✅ Documentation

## Repository Details

- **Location:** $CHROMIUM_DIR/src
- **Branch:** $(git rev-parse --abbrev-ref HEAD)
- **Version:** $(git describe --tags)
- **Commit:** $(git rev-parse --short HEAD)
- **Total Size:** $(du -sh "$CHROMIUM_DIR" | cut -f1)

## Directory Structure

\`\`\`
chromium/
├── src/                   # Main source code
│   ├── chrome/           # ~1GB
│   ├── content/          # Core Content API
│   ├── third_party/      # ~15GB (includes Blink, V8)
│   ├── out/              # Build output (created by build)
│   └── ...
└── .gclient              # gclient configuration
\`\`\`

## Key Components Located

- **Blink Rendering Engine:** \`third_party/blink/\`
- **V8 JavaScript Engine:** \`v8/\`
- **Content API:** \`content/\`
- **Chrome Browser:** \`chrome/\`
- **UI Framework:** \`ui/\`
- **Network Stack:** \`net/\`

## Verification

Run these commands to verify:

\`\`\`bash
cd $CHROMIUM_DIR/src

# Check git status
git status

# Check version
git describe --tags

# List top-level directories
ls -d */
\`\`\`

## Important Files for EtherX Development

### Study These First:
1. \`content/README.md\` - Content API overview
2. \`content/public/\` - Public Content API interfaces
3. \`content/shell/\` - Minimal browser example
4. \`chrome/browser/\` - Chrome browser implementation
5. \`docs/\` - Chromium documentation

### Build Configuration:
- \`build/\` - Build scripts and configuration
- \`BUILD.gn\` - Build file format (throughout tree)
- \`DEPS\` - Dependency specification

## Next Steps

### Phase 1.4: Build Chromium

1. **Configure Build:**
   \`\`\`bash
   cd $CHROMIUM_DIR/src
   gn gen out/Default --args='is_debug=false is_component_build=true'
   \`\`\`

2. **Build Content Shell:**
   \`\`\`bash
   autoninja -C out/Default content_shell
   \`\`\`

3. **Or run script:**
   \`\`\`bash
   ./scripts/phase1/04_chromium_build.sh
   \`\`\`

### Estimated Time:
- First build: 2-6 hours (depending on hardware)
- Incremental builds: minutes

### Build Requirements:
- ✅ Disk space: 100GB+ free
- ✅ RAM: 16GB+ recommended
- ✅ CPU: Multi-core (more cores = faster build)

## Troubleshooting

### If sync fails:
\`\`\`bash
cd $CHROMIUM_DIR/src
gclient sync --force
\`\`\`

### If out of space:
- Remove \`out/\` directory to free ~20GB
- Use external drive
- Consider \`is_component_build=true\` for smaller builds

### Update Chromium:
\`\`\`bash
cd $CHROMIUM_DIR/src
git fetch --tags
git checkout tags/<version>
gclient sync
\`\`\`

## Resources

- **Chromium Docs:** https://chromium.googlesource.com/chromium/src/+/main/docs/
- **GN Build System:** https://gn.googlesource.com/gn/+/main/docs/
- **Depot Tools:** https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools.html

## Time Spent

- **Download Time:** Check timestamps in $LOG_FILE
- **Total Size Downloaded:** ~30-40GB
- **Network Usage:** ~30GB

## Status Checklist

- [x] depot_tools verified
- [x] Disk space checked
- [x] Working directory created
- [x] Chromium source fetched
- [x] Stable version checked out
- [x] Dependencies synced
- [x] Build dependencies installed
- [x] Repository explored

## Ready for Build!

You are now ready to build Chromium. Run:

\`\`\`bash
./scripts/phase1/04_chromium_build.sh
\`\`\`

Or manually:

\`\`\`bash
cd $CHROMIUM_DIR/src
gn gen out/Default
autoninja -C out/Default content_shell
\`\`\`

---

**Status:** ✅ Source code ready for compilation!
EOF

    log_success "Summary saved: $SUMMARY_FILE"
    echo ""
}

################################################################################
# Main
################################################################################
main() {
    local start_time=$(date +%s)
    
    verify_depot_tools
    check_disk_space
    create_working_directory
    fetch_chromium_source
    checkout_stable_version
    sync_dependencies
    install_build_dependencies
    create_repository_info
    explore_repository
    generate_summary
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local hours=$((duration / 3600))
    local minutes=$(((duration % 3600) / 60))
    
    log_success "============================================"
    log_success "Phase 1.3 Chromium Download Complete!"
    log_success "============================================"
    echo ""
    log_info "📊 Statistics"
    log_info "---"
    log_info "Time taken: ${hours}h ${minutes}m"
    log_info "Location: $CHROMIUM_DIR/src"
    log_info "Size: $(du -sh "$CHROMIUM_DIR" | cut -f1)"
    echo ""
    log_success "✅ Source code ready for compilation"
    echo ""
    log_info "📚 Next Steps:"
    log_info "1. Read: $PROJECT_ROOT/CHROMIUM_DOWNLOAD_SUMMARY.md"
    log_info "2. Explore: $CHROMIUM_DIR/src"
    log_info "3. Run: ./scripts/phase1/04_chromium_build.sh"
    echo ""
    log_warning "⏱️  Next phase will take 2-6 hours for first build"
    log_info "Completed at: $(date)"
}

main "$@"
