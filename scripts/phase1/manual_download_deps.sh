#!/bin/bash
# Manual Download of Missing Chromium Dependencies
# This script manually downloads dependencies that gclient hooks failed to fetch

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ETHERX_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"
CHROMIUM_SRC="$ETHERX_DIR/chromium/src"
DEPOT_TOOLS="$ETHERX_DIR/depot_tools"
LOG_DIR="$WORKSPACE_DIR/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Log file
LOG_FILE="$LOG_DIR/manual_download_deps.log"

# Function to log messages
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1" | tee -a "$LOG_FILE"
}

# Function to check if a file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1 exists"
        return 0
    else
        echo -e "${RED}✗${NC} $1 missing"
        return 1
    fi
}

# Function to download file with progress
download_file() {
    local url="$1"
    local output="$2"
    log_info "Downloading: $url"
    log_info "To: $output"
    
    curl -L --progress-bar -o "$output" "$url" || wget --progress=bar:force -O "$output" "$url"
}

# Function to extract tar.gz
extract_targz() {
    local archive="$1"
    local dest_dir="$2"
    log_info "Extracting: $archive"
    log_info "To: $dest_dir"
    
    mkdir -p "$dest_dir"
    tar -xzf "$archive" -C "$dest_dir" --strip-components=1
}

echo "============================================"
echo "  EtherX Browser - Manual Dependencies"
echo "============================================"
echo ""

# Check if Chromium source exists
if [ ! -d "$CHROMIUM_SRC" ]; then
    log_error "Chromium source not found at: $CHROMIUM_SRC"
    exit 1
fi

log "Starting manual dependency download..."
log "Chromium source: $CHROMIUM_SRC"
echo ""

# ============================================
# 1. Download Node.js
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  1. Node.js${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

NODE_DIR="$CHROMIUM_SRC/third_party/node/linux/node-linux-x64"
NODE_BIN="$NODE_DIR/bin/node"

if check_file "$NODE_BIN"; then
    log "Node.js already installed"
else
    log_warning "Node.js missing, downloading..."
    
    # Check for SHA1 file to determine version
    SHA1_FILE="$CHROMIUM_SRC/third_party/node/linux/node-linux-x64.tar.gz.sha1"
    
    if [ -f "$SHA1_FILE" ]; then
        SHA1=$(cat "$SHA1_FILE")
        log_info "Found SHA1: $SHA1"
        
        # Try downloading from Google Storage using depot_tools
        TEMP_ARCHIVE="/tmp/node-linux-x64.tar.gz"
        GS_URL="gs://chromium-nodejs/20.11.0/84e5a452664bf4e4a8aff7ceb16a88e0b5c7b8c2"
        
        log_info "Attempting download from Google Storage..."
        
        # Use gsutil from depot_tools
        if "$DEPOT_TOOLS/gsutil.py" cp "$GS_URL" "$TEMP_ARCHIVE" 2>/dev/null; then
            log "Downloaded Node.js from Google Storage"
            extract_targz "$TEMP_ARCHIVE" "$NODE_DIR"
            rm -f "$TEMP_ARCHIVE"
            
            if check_file "$NODE_BIN"; then
                log "✓ Node.js installed successfully"
            else
                log_error "Node.js extraction failed"
            fi
        else
            log_warning "Google Storage download failed, trying nodejs.org..."
            
            # Fallback: Download from nodejs.org
            # Using Node.js 20.11.0 (LTS)
            NODE_VERSION="20.11.0"
            NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"
            
            download_file "$NODE_URL" "$TEMP_ARCHIVE"
            extract_targz "$TEMP_ARCHIVE" "$NODE_DIR"
            rm -f "$TEMP_ARCHIVE"
            
            if check_file "$NODE_BIN"; then
                log "✓ Node.js installed successfully"
            else
                log_error "Node.js installation failed"
            fi
        fi
    else
        log_error "SHA1 file not found, cannot determine Node.js version"
    fi
fi

echo ""

# ============================================
# 2. Download clang-format
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  2. clang-format${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

CLANG_FORMAT_BIN="$CHROMIUM_SRC/buildtools/linux64/clang-format"

if check_file "$CLANG_FORMAT_BIN"; then
    log "clang-format already installed"
else
    log_warning "clang-format missing, downloading..."
    
    # Use download_from_google_storage.py from depot_tools
    CLANG_FORMAT_SHA1="$CHROMIUM_SRC/buildtools/linux64/clang-format.sha1"
    
    if [ -f "$CLANG_FORMAT_SHA1" ]; then
        log_info "Using download_from_google_storage.py..."
        cd "$CHROMIUM_SRC"
        
        python3 "$DEPOT_TOOLS/download_from_google_storage.py" \
            --no_resume \
            --no_auth \
            --bucket chromium-clang-format \
            -s "$CLANG_FORMAT_SHA1" 2>&1 | tee -a "$LOG_FILE"
        
        if check_file "$CLANG_FORMAT_BIN"; then
            chmod +x "$CLANG_FORMAT_BIN"
            log "✓ clang-format installed successfully"
        else
            log_error "clang-format installation failed"
        fi
    else
        log_warning "clang-format SHA1 file not found"
    fi
fi

echo ""

# ============================================
# 3. Download Clang toolchain
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  3. Clang Toolchain${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

CLANG_BIN="$CHROMIUM_SRC/third_party/llvm-build/Release+Asserts/bin/clang"

if check_file "$CLANG_BIN"; then
    log "Clang toolchain already installed"
else
    log_warning "Clang toolchain missing, running update script..."
    
    cd "$CHROMIUM_SRC"
    python3 tools/clang/scripts/update.py 2>&1 | tee -a "$LOG_FILE"
    
    if check_file "$CLANG_BIN"; then
        log "✓ Clang toolchain installed successfully"
    else
        log_warning "Clang toolchain installation may have failed"
    fi
fi

echo ""

# ============================================
# 4. Download Rust toolchain
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  4. Rust Toolchain${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

RUSTC_BIN="$CHROMIUM_SRC/third_party/rust-toolchain/bin/rustc"

if check_file "$RUSTC_BIN"; then
    log "Rust toolchain already installed"
else
    log_warning "Rust toolchain missing, running update script..."
    
    cd "$CHROMIUM_SRC"
    python3 tools/rust/update_rust.py 2>&1 | tee -a "$LOG_FILE"
    
    if check_file "$RUSTC_BIN"; then
        log "✓ Rust toolchain installed successfully"
    else
        log_warning "Rust toolchain installation may have failed"
    fi
fi

echo ""

# ============================================
# 5. Download GN (Generate Ninja)
# ============================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  5. GN (Generate Ninja)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

GN_BIN="$CHROMIUM_SRC/buildtools/linux64/gn"

if check_file "$GN_BIN"; then
    log "GN already installed"
else
    log_warning "GN missing, downloading..."
    
    GN_SHA1="$CHROMIUM_SRC/buildtools/linux64/gn.sha1"
    
    if [ -f "$GN_SHA1" ]; then
        cd "$CHROMIUM_SRC"
        
        python3 "$DEPOT_TOOLS/download_from_google_storage.py" \
            --no_resume \
            --no_auth \
            --bucket chromium-gn \
            -s "$GN_SHA1" 2>&1 | tee -a "$LOG_FILE"
        
        if check_file "$GN_BIN"; then
            chmod +x "$GN_BIN"
            log "✓ GN installed successfully"
        else
            log_error "GN installation failed"
        fi
    else
        log_warning "GN SHA1 file not found"
    fi
fi

echo ""

# ============================================
# 6. Summary
# ============================================
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Download Summary${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

MISSING=0

echo "Checking critical dependencies:"
echo ""

if check_file "$NODE_BIN"; then
    NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null || echo "unknown")
    log_info "Node.js: $NODE_VERSION"
else
    log_error "Node.js: MISSING"
    MISSING=$((MISSING + 1))
fi

if check_file "$CLANG_BIN"; then
    CLANG_VERSION=$("$CLANG_BIN" --version 2>/dev/null | head -n1 || echo "unknown")
    log_info "Clang: $CLANG_VERSION"
else
    log_error "Clang: MISSING"
    MISSING=$((MISSING + 1))
fi

if check_file "$RUSTC_BIN"; then
    RUST_VERSION=$("$RUSTC_BIN" --version 2>/dev/null || echo "unknown")
    log_info "Rust: $RUST_VERSION"
else
    log_warning "Rust: MISSING (optional)"
fi

if check_file "$GN_BIN"; then
    GN_VERSION=$("$GN_BIN" --version 2>/dev/null || echo "unknown")
    log_info "GN: $GN_VERSION"
else
    log_error "GN: MISSING"
    MISSING=$((MISSING + 1))
fi

if check_file "$CLANG_FORMAT_BIN"; then
    log_info "clang-format: installed"
else
    log_warning "clang-format: MISSING (optional)"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $MISSING -eq 0 ]; then
    log "✓ All critical dependencies installed successfully!"
    log "You can now try building Chromium with:"
    echo ""
    echo -e "  ${BLUE}cd $CHROMIUM_SRC${NC}"
    echo -e "  ${BLUE}ninja -C out/Default content_shell${NC}"
    echo ""
    exit 0
else
    log_error "✗ $MISSING critical dependencies are still missing"
    log_error "Please check the log file: $LOG_FILE"
    exit 1
fi
