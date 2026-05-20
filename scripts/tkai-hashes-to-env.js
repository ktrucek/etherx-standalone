#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HASH_RE = /^[a-f0-9]{64}$/i;

function printUsage() {
    console.log([
        'Usage:',
        '  node scripts/tkai-hashes-to-env.js <input-file> [--write <env-file>]',
        '  node scripts/tkai-hashes-to-env.js --stdin [--write <env-file>]',
        '',
        'Input formats supported:',
        '  1) JSON array of objects: [{"code":"...","hash":"..."}]',
        '  2) JSON array of strings: ["<hash>", "<hash>"]',
        '  3) Plain text containing hashes (one per line or mixed text)',
        '',
        'Examples:',
        '  node scripts/tkai-hashes-to-env.js tokens.json',
        '  node scripts/tkai-hashes-to-env.js tokens.json --write ~/.etherx/.env.local',
        '  pbpaste | node scripts/tkai-hashes-to-env.js --stdin --write ~/.etherx/.env.local',
    ].join('\n'));
}

function expandHome(p) {
    if (!p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

function parseArgs(argv) {
    const args = [...argv];
    if (!args.length || args.includes('-h') || args.includes('--help')) {
        return { help: true };
    }

    let source = null;
    let fromStdin = false;
    let writePath = null;

    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--stdin') {
            fromStdin = true;
            continue;
        }
        if (a === '--write') {
            const next = args[i + 1];
            if (!next) throw new Error('Missing value for --write');
            writePath = expandHome(next);
            i += 1;
            continue;
        }
        if (!source) {
            source = a;
            continue;
        }
        throw new Error(`Unknown argument: ${a}`);
    }

    if (!fromStdin && !source) {
        throw new Error('Provide input file path or use --stdin');
    }

    return { help: false, source, fromStdin, writePath };
}

function extractHashesFromText(text) {
    const matches = String(text || '').match(/[a-f0-9]{64}/gi) || [];
    return matches.map((x) => x.toLowerCase());
}

function parseHashes(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            if (parsed.every((x) => typeof x === 'string')) {
                return parsed
                    .map((x) => x.trim().toLowerCase())
                    .filter((x) => HASH_RE.test(x));
            }
            if (parsed.every((x) => x && typeof x === 'object')) {
                return parsed
                    .map((x) => String(x.hash || '').trim().toLowerCase())
                    .filter((x) => HASH_RE.test(x));
            }
        }
    } catch (_) {
        // Not JSON; fallback to regex extraction from plain text.
    }

    return extractHashesFromText(text).filter((x) => HASH_RE.test(x));
}

function unique(arr) {
    return [...new Set(arr)];
}

function buildEnvLine(hashes) {
    return `export ETHERX_TKAI_VALID_HASHES="${hashes.join(',')}"`;
}

function upsertEnvVar(content, key, valueLine) {
    const lineRe = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
    if (lineRe.test(content)) {
        return content.replace(lineRe, valueLine);
    }
    const trimmed = content.trimEnd();
    return trimmed ? `${trimmed}\n${valueLine}\n` : `${valueLine}\n`;
}

function writeEnvFile(envPath, envLine) {
    const abs = path.resolve(envPath);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    const old = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const next = upsertEnvVar(old, 'ETHERX_TKAI_VALID_HASHES', envLine);
    fs.writeFileSync(abs, next, 'utf8');
    return abs;
}

async function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`Error: ${err.message}`);
        printUsage();
        process.exit(1);
        return;
    }

    if (opts.help) {
        printUsage();
        return;
    }

    const raw = opts.fromStdin
        ? await readStdin()
        : fs.readFileSync(path.resolve(opts.source), 'utf8');

    const hashes = unique(parseHashes(raw));
    if (!hashes.length) {
        console.error('No valid SHA-256 hashes found in input.');
        process.exit(2);
        return;
    }

    const envLine = buildEnvLine(hashes);
    console.log(envLine);
    console.error(`Found ${hashes.length} unique hash(es).`);

    if (opts.writePath) {
        const outPath = writeEnvFile(opts.writePath, envLine);
        console.error(`Updated ${outPath}`);
    }
}

main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
});
