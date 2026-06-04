import { encrypt, decrypt, encryptJSON, decryptJSON } from '@/lib/encryption';

// ============================================
// ENCRYPTION SETUP GUIDE
// ============================================

/**
 * 1. GENERATE YOUR ENCRYPTION KEY
 * 
 * Run this command in your terminal:
 * node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * 
 * Then add to .env.local:
 * ENCRYPTION_KEY=<paste-the-generated-key>
 */

// ============================================
// USAGE EXAMPLES
// ============================================

// Example 1: Encrypt and decrypt text
function example1() {
 const sensitiveData = 'user@example.com';
 
 const encrypted = encrypt(sensitiveData);
 console.log('Encrypted:', encrypted);
 
 const decrypted = decrypt(encrypted);
 console.log('Decrypted:', decrypted);
 // Output: Decrypted: user@example.com
}

// Example 2: Encrypt and decrypt JSON objects
function example2() {
 const userData = {
 id: '123',
 email: 'user@example.com',
 phone: '+1234567890',
 };
 
 const encrypted = encryptJSON(userData);
 console.log('Encrypted JSON:', encrypted);
 
 const decrypted = decryptJSON<typeof userData>(encrypted);
 console.log('Decrypted:', decrypted);
 // Output: { id: '123', email: 'user@example.com', phone: '+1234567890' }
}

// Example 3: Store encrypted data in database
async function example3() {
 const sensitiveInfo = 'secret-api-token';
 const encrypted = encrypt(sensitiveInfo);
 
 // Save to database
 // await supabase.from('users').insert({ encrypted_token: encrypted });
 
 // Retrieve from database and decrypt
 // const { data } = await supabase.from('users').select('encrypted_token').single();
 // const decrypted = decrypt(data.encrypted_token);
}

// Example 4: Use in API route
async function apiRouteExample(req: any, res: any) {
 try {
 const { email } = req.body;
 
 // Encrypt sensitive data before storing
 const encryptedEmail = encrypt(email);
 
 // Store in database
 // await db.users.create({ encryptedEmail });
 
 res.json({ success: true, message: 'Data encrypted and stored' });
 } catch (error) {
 res.status(500).json({ error: 'Encryption failed' });
 }
}

// Example 5: Encrypt WhatsApp contact data
function example5() {
 const contactData = {
 wamid: '1234567890',
 phone: '+1234567890',
 apiKey: 'secret-api-key',
 };
 
 const encrypted = encryptJSON(contactData);
 
 // Store encrypted contact data
 // await supabase.from('contacts').update({ encrypted_data: encrypted });
 
 // Later, decrypt when needed
 const decrypted = decryptJSON(encrypted);
 console.log(decrypted);
}

export { example1, example2, example3, apiRouteExample, example5 };
