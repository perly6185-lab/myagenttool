import { closeSync, openSync, readSync } from "node:fs";

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURES = [Buffer.from("PK\x03\x04", "binary"), Buffer.from("PK\x05\x06", "binary"), Buffer.from("PK\x07\x08", "binary")];
const ENCRYPTION_INFO = Buffer.from("EncryptionInfo\0", "utf16le");
const ENCRYPTED_PACKAGE = Buffer.from("EncryptedPackage\0", "utf16le");
const MAX_INSPECTION_BYTES = 8 * 1024 * 1024;

/**
 * Classify the outer container without parsing or decrypting document content.
 * OOXML is a ZIP package. Password-to-open OOXML is commonly wrapped in an OLE
 * compound file whose directory names include EncryptionInfo and
 * EncryptedPackage. The scan is deliberately bounded and read-only.
 */
export function inspectOfficeDocumentContainer(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(8);
    const headerBytes = readSync(descriptor, header, 0, header.length, 0);
    if (headerBytes >= 4 && ZIP_SIGNATURES.some((signature) => header.subarray(0, 4).equals(signature))) {
      return { kind: "ooxml" };
    }
    if (headerBytes < OLE_SIGNATURE.length || !header.equals(OLE_SIGNATURE)) {
      return { kind: "corrupted" };
    }

    const chunkSize = 64 * 1024;
    const overlapSize = Math.max(ENCRYPTION_INFO.length, ENCRYPTED_PACKAGE.length) - 1;
    let overlap = Buffer.alloc(0);
    let offset = 0;
    let hasEncryptionInfo = false;
    let hasEncryptedPackage = false;
    while (offset < MAX_INSPECTION_BYTES && !(hasEncryptionInfo && hasEncryptedPackage)) {
      const chunk = Buffer.alloc(Math.min(chunkSize, MAX_INSPECTION_BYTES - offset));
      const bytes = readSync(descriptor, chunk, 0, chunk.length, offset);
      if (!bytes) break;
      const searchable = Buffer.concat([overlap, chunk.subarray(0, bytes)]);
      hasEncryptionInfo ||= searchable.indexOf(ENCRYPTION_INFO) >= 0;
      hasEncryptedPackage ||= searchable.indexOf(ENCRYPTED_PACKAGE) >= 0;
      overlap = searchable.subarray(Math.max(0, searchable.length - overlapSize));
      offset += bytes;
    }
    return hasEncryptionInfo && hasEncryptedPackage ? { kind: "encrypted_ooxml" } : { kind: "unsupported_encryption" };
  } finally {
    closeSync(descriptor);
  }
}
