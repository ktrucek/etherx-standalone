# Cleanup and Fix: Root User Issue

## Problem
The build scripts were run as root, which created files in `/root/` and modified root's `.bashrc`. This needs to be cleaned up and fixed.

## Solution: Create a Non-Root User for Development

### Step 1: Clean Up What Was Installed

```bash
# Remove depot_tools from root
rm -rf /root/depot_tools

# Remove depot_tools from root's PATH
# Edit /.bashrc and remove these lines:
# export PATH="$HOME/depot_tools:$PATH"
nano /.bashrc  # or use vim, remove the depot_tools line
```

### Step 2: Create a Development User

```bash
# Create a new user for development
useradd -m -s /bin/bash etherx-dev

# Set a password
passwd etherx-dev

# Add to sudo group (optional, if you need sudo access)
usermod -aG sudo etherx-dev

# Give ownership of the project directory
chown -R etherx-dev:etherx-dev "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"
```

### Step 3: Switch to the New User and Run Scripts

```bash
# Switch to the new user
su - etherx-dev

# Navigate to project directory
cd "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"

# Run the build system as the new user
./etherx_build.sh
```

---

## Alternative: Continue as Root (NOT RECOMMENDED)

If you absolutely must run as root, the scripts will still work but:
- You'll see warnings
- Files will be owned by root
- It's against best practices
- Security risks

To continue as root, just ignore the warning and proceed. The scripts won't damage your WordPress or web files.

---

## What Was Actually Done So Far

### Files Created (SAFE - these are fine):
- All documentation files in the project directory
- Log files in `logs/` directory
- Research files in `research/` directory

### Files Created (NEEDS CLEANUP):
- `/root/depot_tools/` - Cloned depot_tools repository
- `/.bashrc` - Added depot_tools to PATH

### What Was NOT Touched (100% SAFE):
- ✅ WordPress files
- ✅ Other websites
- ✅ Web server configuration
- ✅ Database
- ✅ Any files outside the project directory

---

## Quick Status Check

To see what needs cleanup:

```bash
# Check if depot_tools is in /root
ls -la /root/depot_tools

# Check if .bashrc was modified
grep "depot_tools" /.bashrc

# Check disk usage
df -h

# Check what was created in project directory
ls -la "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"
```

---

## Recommended Disk Space Before Proceeding

Chromium requires significant disk space:
- **depot_tools**: ~500 MB
- **Chromium source**: ~30 GB
- **Build output**: ~15 GB
- **Total needed**: ~50 GB free space

Check your available space:
```bash
df -h /
```

---

## After Cleanup

Once you've cleaned up and created a non-root user, you can safely run:

```bash
# As the new user
./etherx_build.sh
```

The system will:
1. Re-install depot_tools in the new user's home directory
2. Download Chromium source to the new user's home
3. Build Chromium safely without root privileges

---

## Need Help?

If you need to completely reset everything:

```bash
# Clean up root's depot_tools
rm -rf /root/depot_tools

# Remove from root's .bashrc
nano /.bashrc  # Remove depot_tools line

# Remove project logs (optional)
rm -rf "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/logs"

# Remove research files (optional)
rm -rf "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/research"

# The scripts can be run again fresh
```
