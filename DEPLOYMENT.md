# 🚀 EtherX Standalone - Deployment Guide

## Quick Deploy (Automated)

```bash
cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser/standalone-browser/
./deploy.sh
```

**What it does:**

1. ✅ Auto-increments version (2.4.29 → 2.4.30)
2. ✅ Updates `package.json` and `src/index.html`
3. ✅ Commits changes to git
4. ✅ Creates git tag `vX.Y.Z`
5. ✅ Pushes to GitHub (triggers build)

---

## Manual Deploy (Step-by-step)

### 1. Navigate to project folder

```bash
cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser/standalone-browser/
```

### 2. Check current version

```bash
grep '"version"' package.json
```

### 3. Update version (example: 2.4.29 → 2.4.30)

**Update package.json:**

```bash
python3 <<'EOF'
import json
from datetime import datetime, timezone

with open('package.json', 'r') as f:
    data = json.load(f)

data['version'] = '2.4.30'
data['buildTime'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

with open('package.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')

print(f"✓ package.json → v{data['version']}")
EOF
```

**Update src/index.html:**

```bash
python3 <<'EOF'
import re

with open('src/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Update helpVersionNum (Help panel)
content = re.sub(
    r'(<span id="helpVersionNum">)[^<]*(</span>)',
    r'\g<1>2.4.30\g<2>',
    content,
    count=1
)

# Update helpVersionNum2 (Settings → Updates panel)
content = re.sub(
    r'(id="helpVersionNum2">)[^<]*(</span>)',
    r'\g<1>2.4.30\g<2>',
    content,
    count=1
)

with open('src/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ src/index.html → v2.4.30")
EOF
```

### 4. Commit and tag

```bash
git add package.json src/index.html
git commit -m "v2.4.30: [describe changes here]"
git tag v2.4.30
```

### 5. Push to GitHub

```bash
git push origin main
git push origin v2.4.30
```

### 6. Verify build triggered

Visit: https://github.com/ktrucek/etherx-standalone/actions

Wait ~20-30 minutes for build to complete.

---

## Version Numbering

**Format:** `MAJOR.MINOR.PATCH` (e.g., 2.4.30)

- **MAJOR** (2): Breaking changes, major rewrites
- **MINOR** (4): New features, non-breaking changes
- **PATCH** (30): Bug fixes, small improvements

**Examples:**

- Bug fix: `2.4.29 → 2.4.30`
- New feature: `2.4.30 → 2.5.0`
- Breaking change: `2.5.0 → 3.0.0`

---

## Files That Must Match Version

### 1. `package.json`

```json
{
  "version": "2.4.29",
  "buildTime": "2026-03-08T22:27:25Z"
}
```

### 2. `src/index.html` (line 7623)

```html
<span id="helpVersionNum">2.4.29</span>
```

### 3. `src/index.html` (line 8006)

```html
<span id="helpVersionNum2">2.4.29</span>
```

### 4. Git tag

```bash
git tag v2.4.29
```

---

## Troubleshooting

### ❌ Version mismatch between files

**Problem:** Help shows v2.4.26, Settings shows v2.4.25, GitHub is v2.4.29

**Solution:**

```bash
# Check all versions
grep '"version"' package.json
grep 'helpVersionNum' src/index.html | grep -o '[0-9.]*'

# If mismatch, update manually (see step 3 above)
```

### ❌ GitHub Actions not triggered

**Possible causes:**

1. Tag not pushed: `git push origin vX.Y.Z`
2. Workflow file missing: check `.github/workflows/build.yml`
3. Tag format wrong: must be `v*` (e.g., `v2.4.29`)

**Solution:**

```bash
# Check remote tags
git ls-remote --tags origin

# Re-push tag
git tag -d v2.4.29
git tag v2.4.29
git push -f origin v2.4.29
```

### ❌ Build fails on GitHub

**Check build logs:**

1. Visit: https://github.com/ktrucek/etherx-standalone/actions
2. Click on failed workflow
3. Read error messages

**Common issues:**

- Missing `package-lock.json` → Run `npm install` locally, commit lock file
- Syntax error in code → Fix and re-push
- Out of GitHub Actions minutes → Check quota

### ❌ Git not initialized in standalone-browser/

**Problem:** `fatal: not a git repository`

**Solution:**

```bash
cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser/standalone-browser/

# Copy .git from working repo
rm -rf .git
cp -r /tmp/etherx-standalone-fresh/.git .

# Or clone fresh
cd /tmp
git clone https://github.com/ktrucek/etherx-standalone.git
cd etherx-standalone
# Make changes, commit, push
```

---

## Pre-Deploy Checklist

Before running `./deploy.sh` or manual deploy:

- [ ] All changes tested locally
- [ ] No uncommitted changes (or ready to commit)
- [ ] Updated CHANGELOG.md with new features/fixes
- [ ] Version number makes sense (patch vs minor vs major)
- [ ] No syntax errors (`npm run lint` if configured)
- [ ] Service Worker cache version updated (if changed)

---

## Post-Deploy Checklist

After pushing to GitHub:

- [ ] GitHub Actions build triggered
- [ ] Build completes successfully (~20-30 min)
- [ ] All platforms built (Linux, Windows, macOS)
- [ ] GitHub Release created with binaries
- [ ] Download and test one binary
- [ ] Update live demo if needed

---

## GitHub Actions Build Platforms

**Triggered by:** Git tag push `v*`

**Builds:**

- 🐧 **Linux**
  - AppImage (portable, no install)
  - .deb package (Debian/Ubuntu)

- 🪟 **Windows**
  - Portable .exe (no install)
  - ZIP archive

- 🍎 **macOS**
  - .dmg installer (x64)
  - .dmg installer (arm64 - M1/M2)

**Artifacts location:**
https://github.com/ktrucek/etherx-standalone/releases/tag/vX.Y.Z

---

## Environment Variables (deploy.sh)

None required for automated deploy.

For manual GitHub API access:

```bash
export GITHUB_TOKEN="ghp_..."
```

---

## Quick Reference

### Deploy with auto-increment

```bash
cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser/standalone-browser/
./deploy.sh
```

### Deploy with specific version

```bash
./deploy.sh 3.0.0
```

### Local commit only (no push)

```bash
./deploy.sh --no-push
```

### Check current version

```bash
grep '"version"' package.json
```

### Check GitHub latest release

```bash
curl -s https://api.github.com/repos/ktrucek/etherx-standalone/releases/latest | grep tag_name
```

### Force re-trigger build

```bash
git tag -d v2.4.29
git tag v2.4.29
git push -f origin v2.4.29
```

---

## File Locations

| File             | Path                          | Purpose                       |
| ---------------- | ----------------------------- | ----------------------------- |
| Deploy script    | `deploy.sh`                   | Automated deployment          |
| Main process     | `main.js`                     | Electron main (CORS, network) |
| Preload bridge   | `preload.js`                  | IPC API exposure              |
| Service Worker   | `sw.js`                       | Offline support (web mode)    |
| Main UI          | `src/index.html`              | Browser interface             |
| Package info     | `package.json`                | Version, dependencies         |
| Build workflow   | `.github/workflows/build.yml` | GitHub Actions config         |
| Changelog        | `CHANGELOG.md`                | Technical documentation       |
| Deployment guide | `DEPLOYMENT.md`               | This file                     |

---

## Best Practices

1. **Always use deploy.sh** unless you need manual control
2. **Test locally before deploying** (run Electron app, check features)
3. **Update CHANGELOG.md** with every deployment
4. **Use semantic versioning** (MAJOR.MINOR.PATCH)
5. **Keep package.json and index.html versions in sync**
6. **Don't skip versions** (2.4.29 → 2.4.30, not 2.4.29 → 2.4.35)
7. **Monitor GitHub Actions** after push
8. **Download and test built binaries** before announcing release

---

## Support

**Issues:** https://github.com/ktrucek/etherx-standalone/issues  
**Main repo:** https://github.com/ktrucek/etherx-browser-2  
**Website:** https://kriptoentuzijasti.io  
**Email:** support@kriptoentuzijasti.io

---

© 2024-2026 kriptoentuzijasti.io. All Rights Reserved.
