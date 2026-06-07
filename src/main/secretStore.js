"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { safeStorage } = require("electron");

class SecretStore {
    constructor(userDataPath) {
        this.filePath = path.join(userDataPath, "etherx-secrets.bin");
        this.legacyFilePath = path.join(userDataPath, "etherx-secrets.json");
    }

    _fallbackKey() {
        return crypto
            .createHash("sha256")
            .update([
                os.hostname(),
                os.userInfo().username,
                this.filePath,
                process.platform,
                process.arch,
            ].join("|"))
            .digest();
    }

    _encryptString(value) {
        const plainBuffer = Buffer.from(String(value || ""), "utf8");
        if (safeStorage?.isEncryptionAvailable?.()) {
            return Buffer.concat([Buffer.from("v2:"), safeStorage.encryptString(plainBuffer.toString("utf8"))]);
        }

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", this._fallbackKey(), iv);
        const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([Buffer.from("v1:"), iv, tag, encrypted]);
    }

    _decryptBuffer(buffer) {
        const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
        if (!raw.length) return "{}";

        if (raw.subarray(0, 3).toString("utf8") === "v2:") {
            return safeStorage.decryptString(raw.subarray(3));
        }

        if (raw.subarray(0, 3).toString("utf8") === "v1:") {
            const body = raw.subarray(3);
            const iv = body.subarray(0, 12);
            const tag = body.subarray(12, 28);
            const encrypted = body.subarray(28);
            const decipher = crypto.createDecipheriv("aes-256-gcm", this._fallbackKey(), iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
        }

        return raw.toString("utf8");
    }

    _readAll() {
        try {
            if (fs.existsSync(this.filePath)) {
                const payload = fs.readFileSync(this.filePath);
                const decrypted = this._decryptBuffer(payload);
                return JSON.parse(decrypted || "{}");
            }
            if (fs.existsSync(this.legacyFilePath)) {
                const legacy = JSON.parse(fs.readFileSync(this.legacyFilePath, "utf8") || "{}");
                this._writeAll(legacy);
                try { fs.unlinkSync(this.legacyFilePath); } catch (_) { }
                return legacy;
            }
        } catch (_) { }
        return {};
    }

    _writeAll(data) {
        const normalized = JSON.stringify(data || {});
        const encrypted = this._encryptString(normalized);
        fs.writeFileSync(this.filePath, encrypted, { mode: 0o600 });
    }

    getNamespace(namespace) {
        const all = this._readAll();
        const scoped = all?.[namespace];
        return scoped && typeof scoped === "object" && !Array.isArray(scoped)
            ? { ...scoped }
            : (Array.isArray(scoped) ? [...scoped] : {});
    }

    setNamespace(namespace, value) {
        const all = this._readAll();
        all[namespace] = Array.isArray(value) ? [...value] : { ...(value || {}) };
        this._writeAll(all);
        return { ok: true };
    }

    mergeNamespace(namespace, values) {
        const current = this.getNamespace(namespace);
        const next = { ...(current || {}), ...(values || {}) };
        return this.setNamespace(namespace, next);
    }

    deleteKeys(namespace, keys) {
        const current = this.getNamespace(namespace);
        (Array.isArray(keys) ? keys : []).forEach((key) => {
            delete current[key];
        });
        return this.setNamespace(namespace, current);
    }

    getValue(namespace, key, fallback = null) {
        const current = this.getNamespace(namespace);
        return Object.prototype.hasOwnProperty.call(current, key) ? current[key] : fallback;
    }

    setValue(namespace, key, value) {
        return this.mergeNamespace(namespace, { [key]: value });
    }

    removeValue(namespace, key) {
        return this.deleteKeys(namespace, [key]);
    }
}

module.exports = SecretStore;
