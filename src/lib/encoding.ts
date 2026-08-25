// Decode file bytes for Xshell .xsh files: UTF-8 BOM, UTF-16LE BOM, plain
// UTF-8, and a gb18030 fallback for files written by Chinese-locale Windows
// (any replacement chars in the UTF-8 pass trigger the retry).

export function decodeFileBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.slice(3));
  }
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buf);
  } catch {
    return utf8;
  }
}

/** Private-key material rssh can parse (OpenSSH/PEM/PKCS8 headers) — public
 *  keys and certificates must not land in a credential secret slot. */
export const looksLikePem = (text: string): boolean =>
  text.includes("-----BEGIN") &&
  !text.includes("-----BEGIN PUBLIC KEY") &&
  !text.includes("-----BEGIN CERTIFICATE");
