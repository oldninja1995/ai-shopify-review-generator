import { hash, verify } from "@node-rs/bcrypt";

const SALT_ROUNDS = 12;

// Native (napi-rs) bcrypt binding, not the pure-JS `bcryptjs` this used to be — bcryptjs was
// costing ~300-400ms+ per hash/compare even on a fast desktop CPU, and considerably more under
// serverless CPU throttling, which was the dominant cost behind slow login/register requests.
// Same standard bcrypt hash format, so existing password hashes remain valid.
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return verify(plain, hashed);
}
