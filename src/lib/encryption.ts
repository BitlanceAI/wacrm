import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Generates a new encryption key
 * Store this securely in your .env.local
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Encrypts data using AES-256-GCM
 */
export function encrypt(data: string, encryptionKey?: string): string {
  const key = encryptionKey || process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  // Convert hex key back to buffer
  const keyBuffer = Buffer.from(key, 'hex');
  
  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits)');
  }

  // Generate random IV (initialization vector)
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  // Encrypt the data
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get the authentication tag
  const authTag = cipher.getAuthTag();

  // Combine: IV + authTag + encrypted data
  const combined = iv.toString('hex') + authTag.toString('hex') + encrypted;

  return combined;
}

/**
 * Decrypts data encrypted with the encrypt function
 */
export function decrypt(encryptedData: string, encryptionKey?: string): string {
  const key = encryptionKey || process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }

  // Convert hex key back to buffer
  const keyBuffer = Buffer.from(key, 'hex');

  if (keyBuffer.length !== 32) {
    throw new Error('Encryption key must be 32 bytes (256 bits)');
  }

  // Extract IV, authTag, and encrypted data
  const iv = Buffer.from(encryptedData.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(
    encryptedData.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2),
    'hex'
  );
  const encrypted = encryptedData.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);

  // Decrypt the data
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypts JSON data
 */
export function encryptJSON<T>(data: T, encryptionKey?: string): string {
  return encrypt(JSON.stringify(data), encryptionKey);
}

/**
 * Decrypts JSON data
 */
export function decryptJSON<T>(encryptedData: string, encryptionKey?: string): T {
  const decrypted = decrypt(encryptedData, encryptionKey);
  return JSON.parse(decrypted);
}
