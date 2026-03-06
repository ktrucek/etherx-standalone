#!/bin/bash

################################################################################
# EtherX Browser - Phase 1.4: Build Chromium
#
# This script builds Chromium content_shell (minimal browser) to verify
# the development environment is working correctly.
# Expected time: 2-6 hours for first build.
################################################################################

set -e

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

LOG_FILE="$PROJECT_ROOT/logs/phase1_04_chromium_build.log"
CHROMIUM_DIR="$CHROMIUM_ROOT"
BUILD_DIR="$CHROMIUM_DIR/src/out/Default"

mkdir -p "$PROJECT_ROOT/logs"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log_info "============================================"
log_info "EtherX Browser - Chromium Build"
log_info "============================================"
log_info "Started at: $(date)"
echo ""

################################################################################
# Verify source code exists
################################################################################
verify_source_code() {
    log_step "Verifying Chromium source code..."
    
    if [[ ! -d "$CHROMIUM_DIR/src" ]]; then
        log_error "Chromium source not found at: $CHROMIUM_DIR/src"
        log_error "Please run: ./scripts/phase1/03_chromium_download.sh first"
        exit 1
    fi
    
    cd "$CHROMIUM_DIR/src"
    log_success "Source code found"
    log_info "Location: $(pwd)"
    log_info "Branch: $(git rev-parse --abbrev-ref HEAD)"
    echo ""
}

################################################################################
# Check system resources
################################################################################
check_resources() {
    log_step "Checking system resources..."
    
    # Check disk space
    available_space=$(df -BG "$CHROMIUM_DIR" | awk 'NR==2 {print $4}' | sed 's/G//')
    log_info "Available disk space: ${available_space}GB"
    
    if [[ $available_space -lt 50 ]]; then
        log_warning "Low disk space! Build may fail."
        log_warning "Recommendation: Free up more space or use component build"
    fi
    
    # Check RAM
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        total_ram=$(free -g | awk '/^Mem:/{print $2}')
        available_ram=$(free -g | awk '/^Mem:/{print $7}')
        log_info "Total RAM: ${total_ram}GB"
        log_info "Available RAM: ${available_ram}GB"
        
        if [[ $total_ram -lt 16 ]]; then
            log_warning "Less than 16GB RAM. Build may be slow or fail."
            log_warning "Recommendation: Close other applications"
        fi
    fi
    
    # Check CPU cores
    cpu_cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu)
    log_info "CPU cores: $cpu_cores"
    log_info "Parallel jobs will use: $cpu_cores cores"
    
    echo ""
}

################################################################################
# Configure build
################################################################################
configure_build() {
    log_step "Configuring build..."
    
    cd "$CHROMIUM_DIR/src"
    
    # Determine build type
    read -p "Build type? (1=Fast/Debug, 2=Optimized/Release, 3=Custom) [1]: " build_choice
    build_choice=${build_choice:-1}
    
    case $build_choice in
        1)
            log_info "Configuring: Fast incremental build (component, debug)"
            BUILD_ARGS='is_debug=true is_component_build=true symbol_level=1 enable_nacl=false'
            ;;
        2)
            log_info "Configuring: Optimized release build"
            BUILD_ARGS='is_debug=false is_component_build=false symbol_level=0 enable_nacl=false is_official_build=false'
            ;;
        3)
            log_info "Using custom args.gn (will create template if not exists)"
            BUILD_ARGS=""
            ;;
    esac
    
    # Create build directory
    log_info "Creating build directory: $BUILD_DIR"
    mkdir -p "$BUILD_DIR"
    
    # Generate build configuration
    if [[ -n "$BUILD_ARGS" ]]; then
        log_info "Running: gn gen out/Default --args='$BUILD_ARGS'"
        gn gen out/Default --args="$BUILD_ARGS"
    else
        if [[ ! -f "$BUILD_DIR/args.gn" ]]; then
            create_custom_args_gn
        fi
        log_info "Running: gn gen out/Default"
        gn gen out/Default
    fi
    
    log_success "Build configured"
    echo ""
    
    # Show configuration
    log_info "Build configuration:"
    gn args out/Default --list --short | head -n 30
    echo ""
}

################################################################################
# Create custom args.gn
################################################################################
create_custom_args_gn() {
    log_info "Creating custom args.gn..."
    
    cat > "$BUILD_DIR/args.gn" << 'EOF'
# EtherX Browser - Custom Build Configuration

# Build type
is_debug = false
is_component_build = true  # Faster linking, larger binaries

# Symbols (for debugging)
symbol_level = 1  # Minimal symbols (0=none, 1=minimal, 2=full)

# Target
target_cpu = "x64"
target_os = "linux"  # or "mac" for macOS

# Optimizations
is_official_build = false
chrome_pgo_phase = 0  # Disable Profile-Guided Optimization

# Features to disable (faster build)
enable_nacl = false
enable_widevine = false
enable_hangout_services_extension = false
enable_iterator_debugging = false
enable_remoting = false
enable_reporting = false

# Branding
is_chrome_branded = false
use_unofficial_version_number = false

# Performance
use_jumbo_build = false  # Experimental, may speed up build

# Sanitizers (for debugging, disable for speed)
is_asan = false
is_lsan = false
is_msan = false
is_tsan = false
is_ubsan = false

# Additional
treat_warnings_as_errors = false
use_goma = false  # Set true if using distributed compilation
EOF

    log_success "Created: $BUILD_DIR/args.gn"
    log_info "You can edit this file to customize the build"
}

################################################################################
# Build content_shell
################################################################################
build_content_shell() {
    log_step "Building content_shell..."
    log_warning "This will take 2-6 hours on first build!"
    log_info "Started at: $(date)"
    echo ""
    
    cd "$CHROMIUM_DIR/src"
    
    # Calculate parallel jobs (leave 2 cores free)
    local cpu_cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu)
    local jobs=$((cpu_cores > 2 ? cpu_cores - 2 : cpu_cores))
    
    log_info "Building with $jobs parallel jobs..."
    echo ""
    
    # Build
    if autoninja -C out/Default content_shell -j $jobs; then
        log_success "Build completed successfully!"
    else
        log_error "Build failed!"
        log_error "Check logs above for errors"
        log_error "Common issues:"
        log_error "  - Out of memory: Close other apps, reduce -j value"
        log_error "  - Out of disk: Free up space"
        log_error "  - Missing deps: Run build/install-build-deps.sh"
        exit 1
    fi
    
    log_info "Build completed at: $(date)"
    echo ""
}

################################################################################
# Test the build
################################################################################
test_build() {
    log_step "Testing the build..."
    
    CONTENT_SHELL="$BUILD_DIR/content_shell"
    
    if [[ ! -f "$CONTENT_SHELL" ]]; then
        log_error "content_shell binary not found!"
        log_error "Expected at: $CONTENT_SHELL"
        exit 1
    fi
    
    log_success "Binary found: $CONTENT_SHELL"
    log_info "Size: $(du -h "$CONTENT_SHELL" | cut -f1)"
    echo ""
    
    # Try to get version
    log_info "Testing binary..."
    if "$CONTENT_SHELL" --version 2>&1 | head -n 5; then
        log_success "Binary is executable"
    else
        log_warning "Could not get version, but binary exists"
    fi
    
    echo ""
    log_info "To run content_shell:"
    echo "  cd $CHROMIUM_DIR/src"
    echo "  out/Default/content_shell --no-sandbox"
    echo ""
}

################################################################################
# Build statistics
################################################################################
show_build_statistics() {
    log_step "Build statistics..."
    
    cd "$CHROMIUM_DIR/src"
    
    log_info "Output directory size:"
    du -sh "$BUILD_DIR"
    echo ""
    
    log_info "Largest files/directories in build output:"
    du -h "$BUILD_DIR" | sort -rh | head -n 10
    echo ""
    
    log_info "Total Chromium directory size:"
    du -sh "$CHROMIUM_DIR"
    echo ""
}

################################################################################
# Create run script
################################################################################
create_run_script() {
    log_step "Creating convenience run script..."
    
    RUN_SCRIPT="$PROJECT_ROOT/run_content_shell.sh"
    
    cat > "$RUN_SCRIPT" << EOF
#!/bin/bash

# Run Chromium content_shell
# This is a minimal browser for testing

cd "$CHROMIUM_DIR/src"

echo "Starting content_shell..."
echo "Location: $BUILD_DIR/content_shell"
echo ""

# Run with no-sandbox for development
# NEVER use --no-sandbox in production!
out/Default/content_shell --no-sandbox "\$@"
EOF

    chmod +x "$RUN_SCRIPT"
    log_success "Created run script: $RUN_SCRIPT"
    log_info "Usage: $RUN_SCRIPT [url]"
    echo ""
}

################################################################################
# Generate build summary
################################################################################
generate_summary() {
    log_step "Generating build summary..."
    
    SUMMARY_FILE="$PROJECT_ROOT/CHROMIUM_BUILD_SUMMARY.md"
    
    cat > "$SUMMARY_FILE" << EOF
# Chromium Build Summary

**Completed:** $(date)
**Phase:** 1.4 - Chromium Build
**Status:** ✅ Complete

## Build Details

- **Build Directory:** $BUILD_DIR
- **Build Type:** $(gn args "$BUILD_DIR" --short --list | grep "is_debug" || echo "See args.gn")
- **Binary:** $BUILD_DIR/content_shell
- **Binary Size:** $(du -h "$BUILD_DIR/content_shell" | cut -f1)
- **Total Output Size:** $(du -sh "$BUILD_DIR" | cut -f1)

## Build Configuration

\`\`\`gn
$(cat "$BUILD_DIR/args.gn" 2>/dev/null || echo "# Custom configuration")
\`\`\`

## Running content_shell

### Method 1: Direct
\`\`\`bash
cd $CHROMIUM_DIR/src
out/Default/content_shell --no-sandbox
\`\`\`

### Method 2: Convenience Script
\`\`\`bash
$PROJECT_ROOT/run_content_shell.sh
\`\`\`

### With URL:
\`\`\`bash
$PROJECT_ROOT/run_content_shell.sh https://www.example.com
\`\`\`

## Useful Flags

- \`--no-sandbox\` - Disable sandbox (development only!)
- \`--enable-logging\` - Enable detailed logging
- \`--v=1\` - Verbose logging level
- \`--disable-gpu\` - Disable GPU acceleration
- \`--remote-debugging-port=9222\` - Enable DevTools Protocol

Example:
\`\`\`bash
content_shell --no-sandbox --enable-logging --v=1 --remote-debugging-port=9222
\`\`\`

## Incremental Builds

After making code changes:

\`\`\`bash
cd $CHROMIUM_DIR/src
autoninja -C out/Default content_shell
\`\`\`

Incremental builds are much faster (minutes instead of hours).

## Building Other Targets

### Full Chrome Browser:
\`\`\`bash
autoninja -C out/Default chrome
\`\`\`

### Unit Tests:
\`\`\`bash
autoninja -C out/Default unit_tests
\`\`\`

### Browser Tests:
\`\`\`bash
autoninja -C out/Default browser_tests
\`\`\`

## Cleaning Build

Remove build output to free space:
\`\`\`bash
rm -rf $BUILD_DIR
\`\`\`

Or clean specific targets:
\`\`\`bash
gn clean out/Default
\`\`\`

## Troubleshooting

### Build Errors

**Out of Memory:**
- Close other applications
- Reduce parallel jobs: \`ninja -C out/Default content_shell -j 4\`
- Enable swap space
- Use component build: \`is_component_build=true\`

**Out of Disk:**
- Free up space
- Remove old build outputs
- Use external drive

**Missing Symbols:**
- Increase \`symbol_level\` in args.gn
- Rebuild

### Runtime Errors

**Sandbox Errors:**
- Use \`--no-sandbox\` flag (development only!)
- Or configure sandbox properly

**Library Errors:**
- Check \`LD_LIBRARY_PATH\`
- For component build, libraries are in out/Default/

**GPU Errors:**
- Use \`--disable-gpu\` flag
- Update graphics drivers

## Next Steps

### Phase 2: Build EtherX MVP

Now that you have Chromium building, you can:

1. **Choose Framework:**
   - CEF (Chromium Embedded Framework)
   - Electron
   - Direct Content API

2. **Study Examples:**
   - content_shell source: \`content/shell/\`
   - chrome browser: \`chrome/browser/\`

3. **Start Building EtherX:**
   - Run: \`./scripts/phase2/01_application_shell.sh\`

## Build Performance

### First Build:
- Time: 2-6 hours (depends on hardware)
- CPU: 100% on all cores
- RAM: 8-32GB used
- Disk I/O: Heavy

### Incremental Builds:
- Time: Minutes
- Only changed files recompiled
- Much less resource intensive

### Tips for Faster Builds:
- Use \`is_component_build=true\`
- Use \`ccache\` for caching compilation
- Use \`goma\` for distributed compilation (Google internal)
- Use SSD for source and build
- More RAM = better (32GB+ ideal)
- More CPU cores = faster

## Resources

- **Chromium Build Docs:** https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md
- **GN Reference:** https://gn.googlesource.com/gn/+/main/docs/reference.md
- **Ninja Manual:** https://ninja-build.org/manual.html

## Disk Usage

\`\`\`
Total: $(du -sh "$CHROMIUM_DIR" | cut -f1)
├── src/: $(du -sh "$CHROMIUM_DIR/src" --exclude=out | cut -f1)
└── out/: $(du -sh "$BUILD_DIR" | cut -f1)
\`\`\`

## Status

- [x] Source code verified
- [x] Build configured
- [x] content_shell built
- [x] Binary tested
- [x] Run script created
- [x] Ready for Phase 2

---

**Status:** ✅ Chromium successfully built!

**Next:** Study content_shell and prepare for EtherX development.

Run: \`$PROJECT_ROOT/run_content_shell.sh\` to test!
EOF

    log_success "Summary saved: $SUMMARY_FILE"
    echo ""
}

################################################################################
# Main
################################################################################
main() {
    local start_time=$(date +%s)
    
    verify_source_code
    check_resources
    configure_build
    build_content_shell
    test_build
    show_build_statistics
    create_run_script
    generate_summary
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local hours=$((duration / 3600))
    local minutes=$(((duration % 3600) / 60))
    
    log_success "============================================"
    log_success "Phase 1.4 Chromium Build Complete!"
    log_success "============================================"
    echo ""
    log_info "📊 Statistics"
    log_info "---"
    log_info "Time taken: ${hours}h ${minutes}m"
    log_info "Build output: $BUILD_DIR"
    log_info "Binary: content_shell"
    log_info "Size: $(du -sh "$BUILD_DIR" | cut -f1)"
    echo ""
    log_success "✅ Chromium successfully built!"
    echo ""
    log_info "🚀 Try it:"
    log_info "  $PROJECT_ROOT/run_content_shell.sh"
    echo ""
    log_info "📚 Next Steps:"
    log_info "1. Test: Run content_shell"
    log_info "2. Read: $SUMMARY_FILE"
    log_info "3. Study: content_shell source code"
    log_info "4. Decide: CEF vs Electron vs Direct API"
    log_info "5. Begin: Phase 2 - EtherX MVP"
    echo ""
    log_info "Completed at: $(date)"
}

main "$@"
