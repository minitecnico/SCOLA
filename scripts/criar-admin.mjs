// Cria (ou redefine a senha de) o ADMINISTRADOR do sistema — você.
// Uso:  npm run admin -- seu@email.com "Seu Nome" [senha] [--local]
// Sem senha, gera uma aleatória e mostra na tela.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, webcrypto } from 'node:crypto';

const args = process.argv.slice(2).filter((a) => a !== '--local');
const local = process.argv.includes('--local');
const [email, name = 'Administrador', given] = args;
if (!email || !email.includes('@')) {
  console.error('Uso: npm run admin -- seu@email.com "Seu Nome" [senha] [--local]');
  process.exit(1);
}
const password = given || randomBytes(9).toString('base64url');
if (password.length < 6) {
  console.error('A senha precisa de pelo menos 6 caracteres.');
  process.exit(1);
}

const ITER = 50_000; // mesmo padrão do Worker (worker/auth.ts)
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
const b64 = (u) => Buffer.from(u).toString('base64');
const hash = `pbkdf2$${ITER}$${b64(salt)}$${b64(new Uint8Array(bits))}`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql =
  `INSERT INTO users (id, email, password_hash, full_name, is_admin, must_change_pw) ` +
  `VALUES (${q(randomUUID())}, ${q(email.toLowerCase())}, ${q(hash)}, ${q(name)}, 1, 0) ` +
  `ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash, is_admin = 1, full_name = excluded.full_name;`;

execFileSync('npx', ['wrangler', 'd1', 'execute', 'scola', local ? '--local' : '--remote', '--command', sql], { stdio: 'inherit' });
console.log(`\n✔ Administrador pronto${local ? ' (banco LOCAL)' : ''}.\n  E-mail: ${email}\n  Senha:  ${password}\n`);
