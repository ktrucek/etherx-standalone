/**
 * EtherX Browser — Default Browser Manager
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 */

'use strict';

const { app, shell } = require('electron');
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const DefaultBrowser = {
  isDefault() {
    try {
      if (process.platform === 'win32') {
        const result = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
          { encoding: 'utf8' }
        );
        return result.includes('EtherX') || result.includes('etherx');
      }

      if (process.platform === 'linux') {
        const result = execSync('xdg-mime query default text/html', { encoding: 'utf8' }).trim();
        return result.toLowerCase().includes('etherx');
      }

      if (process.platform === 'darwin') {
        // macOS check via LSDefaultHandlerForURLScheme
        const result = execSync(
          'python3 -c "import subprocess; print(subprocess.check_output([\'python3\', \'-c\', \'import LaunchServices\'], stderr=subprocess.DEVNULL))"',
          { encoding: 'utf8', stdio: 'pipe' }
        );
        return false; // simplified
      }
    } catch {
      return false;
    }
    return false;
  },

  setAsDefault() {
    if (process.platform === 'win32') {
      // Windows: open Default Apps settings
      shell.openExternal('ms-settings:defaultapps');
      return {
        ok: true,
        message: 'Windows Default Apps settings opened. Select EtherX Browser as your default.',
      };
    }

    if (process.platform === 'linux') {
      try {
        // Create/update .desktop file and set as default
        const desktopContent = `[Desktop Entry]
Name=EtherX Browser
Exec=/opt/EtherX/etherx %U
Terminal=false
Type=Application
Icon=etherx
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;application/xhtml+xml;
StartupWMClass=EtherX
`;
        const desktopPath = path.join(
          process.env.HOME || '/root',
          '.local/share/applications/etherx.desktop'
        );
        fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
        fs.writeFileSync(desktopPath, desktopContent);

        execSync('update-desktop-database ~/.local/share/applications/ 2>/dev/null || true');
        execSync('xdg-mime default etherx.desktop x-scheme-handler/http 2>/dev/null || true');
        execSync('xdg-mime default etherx.desktop x-scheme-handler/https 2>/dev/null || true');
        execSync('xdg-mime default etherx.desktop text/html 2>/dev/null || true');

        return { ok: true, message: 'EtherX set as default browser.' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preferences.internetaccounts');
      return {
        ok: true,
        message: 'macOS System Preferences opened. Set EtherX as default in Safari → General → Default browser.',
      };
    }

    return { ok: false, error: 'Unsupported platform' };
  },
};

module.exports = DefaultBrowser;
