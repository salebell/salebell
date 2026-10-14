// Dependency-free verifier for Apple App Store signed data (JWS, ES256 + x5c).
//
// Mirrors the checks in Apple's app-store-server-library SignedDataVerifier
// (offline mode): the intermediate must be signed by a locally trusted Apple
// root, the leaf by the intermediate, issuer/subject names must chain, the
// intermediate must be a CA, Apple's leaf and intermediate marker OIDs must be
// present, every certificate must be valid at the payload's signedDate, and the
// JWS signature must verify with the leaf key.
//
// Apple's library is not used because its node:crypto X509Certificate usage is
// not fully implemented in the Supabase Edge (Deno) runtime ("Not implemented:
// crypto.X509Certificate.prototype.toString"). OCSP revocation is not checked.
// Only WebCrypto is used here, so this runs unchanged in Deno and Node.

type Bytes = Uint8Array<ArrayBuffer>;

const LEAF_OID = "1.2.840.113635.100.6.11.1";
const INTERMEDIATE_OID = "1.2.840.113635.100.6.2.1";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";

const CURVES: Record<string, { name: string; size: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", size: 32 },
  "1.3.132.0.34": { name: "P-384", size: 48 },
};
const ECDSA_HASHES: Record<string, string> = {
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
};

export type VerificationReason =
  | "malformed_jws"
  | "unsupported_algorithm"
  | "invalid_certificate_chain"
  | "untrusted_chain"
  | "invalid_apple_oid"
  | "certificate_not_valid"
  | "invalid_jws_signature";

export class AppleJwsVerificationError extends Error {
  readonly reason: VerificationReason;
  constructor(reason: VerificationReason) {
    super(reason);
    this.reason = reason;
    this.name = "AppleJwsVerificationError";
  }
}

const fail = (reason: VerificationReason): never => {
  throw new AppleJwsVerificationError(reason);
};

// ---------- minimal DER reader ----------

type Der = { tag: number; bytes: Bytes; content: Bytes };

function readDer(buf: Bytes, offset = 0): Der & { end: number } {
  if (offset + 2 > buf.length) throw new Error("der");
  const tag = buf[offset];
  let len = buf[offset + 1];
  let pos = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4 || pos + n > buf.length) throw new Error("der");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[pos++];
  }
  const end = pos + len;
  if (end > buf.length) throw new Error("der");
  return { tag, bytes: buf.subarray(offset, end), content: buf.subarray(pos, end), end };
}

function children(node: Der): Der[] {
  const out: Der[] = [];
  let pos = 0;
  while (pos < node.content.length) {
    const child = readDer(node.content, pos);
    out.push(child);
    pos = child.end;
  }
  return out;
}

function oid(node: Der): string {
  if (node.tag !== 0x06) throw new Error("der");
  const b = node.content;
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let value = 0;
  for (let i = 1; i < b.length; i++) {
    value = value * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

function time(node: Der): Date {
  const s = new TextDecoder().decode(node.content);
  const m = node.tag === 0x17
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s)
    : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new Error("der");
  let year = Number(m[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- X.509 ----------

type Cert = {
  der: Bytes;
  tbs: Bytes;
  sigHash: string;
  signature: Bytes; // DER ECDSA-Sig-Value
  issuer: Bytes;
  subject: Bytes;
  notBefore: Date;
  notAfter: Date;
  spki: Bytes;
  curve: { name: string; size: number };
  extensions: Map<string, Bytes>;
};

function parseCert(der: Bytes): Cert {
  try {
    const root = readDer(der);
    if (root.tag !== 0x30 || root.end !== der.length) throw new Error("der");
    const [tbsNode, sigAlgNode, sigNode] = children(root);
    const tbs = children(tbsNode);
    let i = tbs[0].tag === 0xa0 ? 1 : 0; // optional [0] version
    i++; // serialNumber
    i++; // signature algorithm (inner)
    const issuer = tbs[i++];
    const validity = children(tbs[i++]);
    const subject = tbs[i++];
    const spki = tbs[i++];
    const extensions = new Map<string, Bytes>();
    for (; i < tbs.length; i++) {
      if (tbs[i].tag !== 0xa3) continue;
      for (const ext of children(children(tbs[i])[0])) {
        const parts = children(ext);
        extensions.set(oid(parts[0]), parts[parts.length - 1].content);
      }
    }
    const spkiAlg = children(children(spki)[0]);
    if (oid(spkiAlg[0]) !== "1.2.840.10045.2.1") throw new Error("not EC");
    const curve = CURVES[oid(spkiAlg[1])];
    const sigHash = ECDSA_HASHES[oid(children(sigAlgNode)[0])];
    if (!curve || !sigHash || sigNode.tag !== 0x03 || sigNode.content[0] !== 0) throw new Error("alg");
    return {
      der,
      tbs: tbsNode.bytes,
      sigHash,
      signature: sigNode.content.subarray(1),
      issuer: issuer.bytes,
      subject: subject.bytes,
      notBefore: time(validity[0]),
      notAfter: time(validity[1]),
      spki: spki.bytes,
      curve,
      extensions,
    };
  } catch {
    return fail("invalid_certificate_chain");
  }
}

// DER ECDSA-Sig-Value (SEQUENCE { r INTEGER, s INTEGER }) -> raw r||s for WebCrypto.
function derSignatureToRaw(sig: Bytes, size: number): Bytes {
  const [r, s] = children(readDer(sig));
  const out = new Uint8Array(size * 2);
  for (const [k, int] of [[0, r], [1, s]] as const) {
    let v = int.content;
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error("der");
    out.set(v, k * size + size - v.length);
  }
  return out;
}

async function importKey(cert: Cert): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "spki", cert.spki, { name: "ECDSA", namedCurve: cert.curve.name }, false, ["verify"],
  );
}

async function signedBy(child: Cert, parent: Cert): Promise<boolean> {
  if (!bytesEqual(child.issuer, parent.subject)) return false;
  try {
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: child.sigHash },
      await importKey(parent),
      derSignatureToRaw(child.signature, parent.curve.size),
      child.tbs,
    );
  } catch {
    return false;
  }
}

function isCa(cert: Cert): boolean {
  const ext = cert.extensions.get(BASIC_CONSTRAINTS_OID);
  if (!ext) return false;
  try {
    const fields = children(readDer(ext));
    return fields.length > 0 && fields[0].tag === 0x01 && fields[0].content[0] !== 0;
  } catch {
    return false;
  }
}

const validAt = (c: Cert, d: Date) => c.notBefore <= d && d <= c.notAfter;

// ---------- base64 ----------

function b64(value: string): Bytes {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function b64url(value: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("b64url");
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  return b64(s + "=".repeat((4 - (s.length % 4)) % 4));
}

// ---------- public API ----------

export type TrustedRoots = Cert[];

export function loadTrustedRoots(base64Der: string[]): TrustedRoots {
  return base64Der.map((s) => parseCert(b64(s)));
}

/**
 * Verifies an Apple-signed JWS and returns its payload. `now` is only used when
 * the payload has no signedDate (Apple payloads always have one).
 */
export async function verifyAppleJws<T extends { signedDate?: number }>(
  jws: string,
  roots: TrustedRoots,
  now: Date = new Date(),
): Promise<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) fail("malformed_jws");
  const [h, p, s] = parts;

  let header: { alg?: unknown; x5c?: unknown };
  let payload: T;
  let signature: Bytes;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h)));
    payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    signature = b64url(s);
  } catch {
    return fail("malformed_jws");
  }
  if (!payload || typeof payload !== "object") fail("malformed_jws");
  if (header.alg !== "ES256") fail("unsupported_algorithm");
  if (
    !Array.isArray(header.x5c) || header.x5c.length < 2 ||
    !header.x5c.every((c) => typeof c === "string")
  ) fail("invalid_certificate_chain");

  const x5c = header.x5c as string[];
  let leaf: Cert, intermediate: Cert;
  try {
    leaf = parseCert(b64(x5c[0]));
    intermediate = parseCert(b64(x5c[1]));
  } catch {
    return fail("invalid_certificate_chain");
  }

  // The x5c root is ignored: the intermediate must chain to a locally trusted root.
  let root: Cert | undefined;
  for (const candidate of roots) {
    if (await signedBy(intermediate, candidate)) {
      root = candidate;
      break;
    }
  }
  if (!root || !(await signedBy(leaf, intermediate)) || !isCa(intermediate)) fail("untrusted_chain");
  if (!leaf.extensions.has(LEAF_OID) || !intermediate.extensions.has(INTERMEDIATE_OID)) {
    fail("invalid_apple_oid");
  }

  const effective = typeof payload.signedDate === "number" ? new Date(payload.signedDate) : now;
  if (!validAt(leaf, effective) || !validAt(intermediate, effective) || !validAt(root!, effective)) {
    fail("certificate_not_valid");
  }

  if (leaf.curve.name !== "P-256" || signature.length !== 64) fail("invalid_jws_signature");
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await importKey(leaf),
    signature,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) fail("invalid_jws_signature");
  return payload;
}
