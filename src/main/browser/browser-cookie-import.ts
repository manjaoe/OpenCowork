import { app } from 'electron'
import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { createHash, createDecipheriv, pbkdf2Sync } from 'crypto'
import { join } from 'path'
import { platform } from 'os'
import Database from 'better-sqlite3'
import {
  getBuiltInBrowserSession,
  resolveDetectedBrowserProfile,
  type BrowserProfileCandidate
} from './browser-emulation'
import {
  normalizeBrowserUserDataSource,
  type BrowserUserDataSource,
  type ConcreteBrowserUserDataSource
} from '../../shared/browser-plugin'

export interface CookieImportResult {
  browserName: string
  profileDisplayName: string
  imported: number
  skipped: number
  failed: number
  total: number
}

interface RawCookieRow {
  host_key: string
  name: string
  value: string
  encrypted_value: Buffer | null
  path: string
  is_secure: number
  is_httponly: number
  expires_utc: number
  samesite: number
}

// Chromium stores expirations as microseconds since 1601-01-01 (Windows epoch).
const CHROMIUM_EPOCH_OFFSET_MICROS = 11644473600000000

// macOS/Linux CBC key derivation constants shared across Chromium browsers.
const CBC_SALT = 'saltysalt'
const CBC_KEY_LENGTH = 16
const CBC_IV = Buffer.alloc(16, ' ')
const MAC_PBKDF2_ITERATIONS = 1003
const LINUX_PBKDF2_ITERATIONS = 1

const KEYCHAIN_SERVICE_BY_BROWSER: Record<ConcreteBrowserUserDataSource, string> = {
  chrome: 'Chrome Safe Storage',
  edge: 'Microsoft Edge Safe Storage',
  brave: 'Brave Safe Storage',
  chromium: 'Chromium Safe Storage'
}

const KEYCHAIN_ACCOUNT_BY_BROWSER: Record<ConcreteBrowserUserDataSource, string> = {
  chrome: 'Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  chromium: 'Chromium'
}

class CookieImportError extends Error {}

function locateCookieDatabase(profilePath: string): string | null {
  // Newer Chromium keeps the cookie store under Network/; older builds keep it at the profile root.
  const networkCookies = join(profilePath, 'Network', 'Cookies')
  if (existsSync(networkCookies)) return networkCookies
  const legacyCookies = join(profilePath, 'Cookies')
  if (existsSync(legacyCookies)) return legacyCookies
  return null
}

function stripPkcs7(buffer: Buffer): Buffer {
  const padLength = buffer[buffer.length - 1]
  if (padLength > 0 && padLength <= 16 && padLength <= buffer.length) {
    return buffer.subarray(0, buffer.length - padLength)
  }
  return buffer
}

// Chromium prepends the SHA-256 of the host to the plaintext on recent macOS/Linux builds.
function stripDomainHashPrefix(decrypted: Buffer, hostKey: string): Buffer {
  if (decrypted.length < 32) return decrypted
  const expected = createHash('sha256').update(hostKey).digest()
  return decrypted.subarray(0, 32).equals(expected) ? decrypted.subarray(32) : decrypted
}

function readMacKeychainPassword(browserId: ConcreteBrowserUserDataSource): string {
  const service = KEYCHAIN_SERVICE_BY_BROWSER[browserId]
  const account = KEYCHAIN_ACCOUNT_BY_BROWSER[browserId]
  try {
    return execFileSync('security', ['find-generic-password', '-wa', account, '-s', service], {
      encoding: 'utf8'
    }).trim()
  } catch (error) {
    throw new CookieImportError(
      `Unable to read "${service}" from the macOS keychain. Grant access when prompted, then retry. (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
}

function deriveCbcKey(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, CBC_SALT, iterations, CBC_KEY_LENGTH, 'sha1')
}

function decryptCbc(encrypted: Buffer, key: Buffer, hostKey: string): string | null {
  // encrypted still carries its 3-byte "v10"/"v11" version tag.
  const ciphertext = encrypted.subarray(3)
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) return null
  const decipher = createDecipheriv('aes-128-cbc', key, CBC_IV)
  decipher.setAutoPadding(false)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const unpadded = stripDomainHashPrefix(stripPkcs7(decrypted), hostKey)
  return unpadded.toString('utf8')
}

function readWindowsAesKey(dataRoot: string): Buffer {
  const localStatePath = join(dataRoot, 'Local State')
  let encryptedKeyB64: string
  try {
    const localState = JSON.parse(readFileSync(localStatePath, 'utf8')) as {
      os_crypt?: { encrypted_key?: string }
    }
    encryptedKeyB64 = localState.os_crypt?.encrypted_key ?? ''
  } catch (error) {
    throw new CookieImportError(
      `Unable to read the encryption key from "${localStatePath}". (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
  if (!encryptedKeyB64) {
    throw new CookieImportError('The browser did not expose an os_crypt encryption key.')
  }

  // Strip the 5-byte "DPAPI" prefix, then unprotect the key via the current user's DPAPI scope.
  const encryptedKey = Buffer.from(encryptedKeyB64, 'base64').subarray(5)
  return dpapiUnprotect(encryptedKey)
}

function dpapiUnprotect(data: Buffer): Buffer {
  const base64 = data.toString('base64')
  const script = [
    'Add-Type -AssemblyName System.Security;',
    `$b=[Convert]::FromBase64String('${base64}');`,
    '$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,',
    '[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Convert]::ToBase64String($p)'
  ].join('')
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8' }
    ).trim()
    return Buffer.from(out, 'base64')
  } catch (error) {
    throw new CookieImportError(
      `DPAPI decryption failed. (${error instanceof Error ? error.message : String(error)})`
    )
  }
}

function decryptGcm(encrypted: Buffer, key: Buffer): string | null {
  // Layout: 3-byte version tag + 12-byte nonce + ciphertext + 16-byte auth tag.
  if (encrypted.length < 3 + 12 + 16) return null
  const nonce = encrypted.subarray(3, 15)
  const tag = encrypted.subarray(encrypted.length - 16)
  const ciphertext = encrypted.subarray(15, encrypted.length - 16)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    return null
  }
}

interface Decryptor {
  decrypt(row: RawCookieRow): string | null
}

function createDecryptor(candidate: BrowserProfileCandidate): Decryptor {
  const os = platform()

  if (os === 'darwin') {
    const password = readMacKeychainPassword(candidate.browserId)
    const key = deriveCbcKey(password, MAC_PBKDF2_ITERATIONS)
    return {
      decrypt(row) {
        if (row.value) return row.value
        if (!row.encrypted_value || row.encrypted_value.length === 0) return null
        return decryptCbc(row.encrypted_value, key, row.host_key)
      }
    }
  }

  if (os === 'win32') {
    const key = readWindowsAesKey(candidate.dataRoot)
    return {
      decrypt(row) {
        if (row.value) return row.value
        const encrypted = row.encrypted_value
        if (!encrypted || encrypted.length === 0) return null
        const version = encrypted.subarray(0, 3).toString('latin1')
        // v10/v11 are AES-256-GCM; v20 is app-bound and cannot be decrypted outside the browser.
        if (version === 'v10' || version === 'v11') return decryptGcm(encrypted, key)
        return null
      }
    }
  }

  // Linux: fall back to the well-known "peanuts" password used when no keyring entry is present.
  const key = deriveCbcKey('peanuts', LINUX_PBKDF2_ITERATIONS)
  return {
    decrypt(row) {
      if (row.value) return row.value
      if (!row.encrypted_value || row.encrypted_value.length === 0) return null
      return decryptCbc(row.encrypted_value, key, row.host_key)
    }
  }
}

function toExpirationDate(expiresUtc: number): number | undefined {
  if (!expiresUtc) return undefined
  const seconds = (expiresUtc - CHROMIUM_EPOCH_OFFSET_MICROS) / 1_000_000
  return seconds > 0 ? Math.floor(seconds) : undefined
}

function toSameSite(samesite: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  if (samesite === 0) return 'no_restriction'
  if (samesite === 1) return 'lax'
  if (samesite === 2) return 'strict'
  return 'unspecified'
}

function toCookieUrl(row: RawCookieRow): string {
  const host = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key
  const scheme = row.is_secure ? 'https' : 'http'
  const path = row.path || '/'
  return `${scheme}://${host}${path}`
}

function readCookieRows(cookieDbPath: string): RawCookieRow[] {
  const scratchCopy = join(app.getPath('temp'), `opencowork-cookies-${process.pid}.sqlite`)
  // The live cookie DB is locked while the browser runs; work on a copy.
  copyFileSync(cookieDbPath, scratchCopy)
  try {
    const db = new Database(scratchCopy, { readonly: true, fileMustExist: true })
    try {
      return db
        .prepare(
          `SELECT host_key, name, value, encrypted_value, path,
                  is_secure, is_httponly, expires_utc, samesite
             FROM cookies`
        )
        .all() as RawCookieRow[]
    } finally {
      db.close()
    }
  } finally {
    try {
      rmSync(scratchCopy, { force: true })
    } catch {
      // best-effort cleanup
    }
  }
}

export async function importCookiesFromLocalBrowser(
  source: BrowserUserDataSource
): Promise<CookieImportResult> {
  const normalized = normalizeBrowserUserDataSource(source)
  const candidate = resolveDetectedBrowserProfile(normalized)
  if (!candidate) {
    throw new CookieImportError(
      'No local browser profile was detected for the selected source. Make sure the browser is installed and has been used at least once.'
    )
  }

  const cookieDbPath = locateCookieDatabase(candidate.profilePath)
  if (!cookieDbPath) {
    throw new CookieImportError(
      `Could not find a cookie store in ${candidate.profilePath}. Fully quit ${candidate.browserName} and retry.`
    )
  }

  const decryptor = createDecryptor(candidate)
  const rows = readCookieRows(cookieDbPath)
  const browserSession = getBuiltInBrowserSession()

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    if (!row.name && !row.value && !row.encrypted_value) {
      skipped += 1
      continue
    }

    let value: string | null
    try {
      value = decryptor.decrypt(row)
    } catch {
      value = null
    }

    if (value === null) {
      // Almost always an app-bound (v20) cookie we cannot decrypt outside the browser.
      skipped += 1
      continue
    }

    try {
      await browserSession.cookies.set({
        url: toCookieUrl(row),
        name: row.name,
        value,
        domain: row.host_key || undefined,
        path: row.path || '/',
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        expirationDate: toExpirationDate(row.expires_utc),
        sameSite: toSameSite(row.samesite)
      })
      imported += 1
    } catch {
      failed += 1
    }
  }

  try {
    browserSession.flushStorageData()
  } catch {
    // best-effort persistence flush
  }

  return {
    browserName: candidate.browserName,
    profileDisplayName: candidate.profileDisplayName,
    imported,
    skipped,
    failed,
    total: rows.length
  }
}

export function isCookieImportError(error: unknown): error is CookieImportError {
  return error instanceof CookieImportError
}
