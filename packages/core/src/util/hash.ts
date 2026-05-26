import { createHash } from "crypto"

export namespace Hash {
  export function fast(input: string | Buffer): string {
    const data: string | Uint8Array = typeof input === "string" ? input : new Uint8Array(input)
    return createHash("sha1").update(data).digest("hex")
  }
}
