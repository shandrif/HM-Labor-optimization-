// Prints SQL to create a user. Usage: node scripts/hash-password.mjs <username> "<Full Name>" <role> <password>
import { pbkdf2Sync, randomBytes } from "node:crypto";

const [username, name, role, password] = process.argv.slice(2);
if (!username || !name || !role || !password) {
  console.error('Usage: node scripts/hash-password.mjs <username> "<Full Name>" <admin|manager|viewer> <password>');
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
console.log(`INSERT INTO users (username, name, role, password_hash, salt) VALUES (${q(username)}, ${q(name)}, ${q(role)}, ${q(hash)}, ${q(salt)});`);
