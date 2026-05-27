import { createHmac } from "node:crypto";
import { env } from "./env";

function normalize(email: string): string {
  return email.toLowerCase().trim();
}

export function generateToken(email: string): string {
  return createHmac("sha256", env.QR_SECRET())
    .update(normalize(email))
    .digest("hex")
    .substring(0, 16);
}

export function encodeEmail(email: string): string {
  return Buffer.from(normalize(email), "utf-8").toString("base64url");
}

export function decodeEmail(encoded: string): string | null {
  try {
    const email = Buffer.from(encoded, "base64url").toString("utf-8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

export function verifyToken(token: string, email: string): boolean {
  return generateToken(email) === token;
}

export function buildCheckinUrl(email: string): string {
  return `${env.BASE_URL()}/checkin?t=${generateToken(email)}&e=${encodeEmail(email)}`;
}
