import crypto from "crypto"

export function createDaemonToken(): string {
  return crypto.randomBytes(32).toString("hex")
}
