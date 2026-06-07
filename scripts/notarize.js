#!/usr/bin/env node
'use strict';

const path = require('path');

exports.default = async function notarizeApp(context) {
    if (process.platform !== 'darwin') return;

    const { electronPlatformName, appOutDir } = context || {};
    if (electronPlatformName !== 'darwin') return;

    const appleId = process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;

    if (!appleId || !appleIdPassword || !teamId) {
        console.log('[notarize] Skipping notarization (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not fully set).');
        return;
    }

    const { notarize } = require('@electron/notarize');
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`[notarize] Notarizing ${appPath}`);
    await notarize({
        appPath,
        appleId,
        appleIdPassword,
        teamId,
    });
    console.log('[notarize] Notarization complete.');
};
