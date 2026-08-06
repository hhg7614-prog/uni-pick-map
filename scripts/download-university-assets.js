"use strict";

/*
 * Safe asset verifier/downloader. Add a `downloadUrl` only after checking the
 * original site's use terms and the record's license metadata. This script
 * deliberately skips records without it instead of guessing or hotlinking.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceFile = path.join(root, "assets/university-sources/image-sources.json");
const errorFile = path.join(root, "assets/university-sources/download-errors.json");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isImage = (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  || buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  || buffer.subarray(0, 6).toString() === "GIF87a"
  || buffer.subarray(0, 6).toString() === "GIF89a"
  || buffer.subarray(0, 5).toString() === "<?xml";

async function main() {
  const records = JSON.parse(await fs.readFile(sourceFile, "utf8"));
  const errors = [];
  const hashes = new Map();
  for (const record of records) {
    if (!record.downloadUrl) continue;
    try {
      const response = await fetch(record.downloadUrl, { headers: { "User-Agent": "UNI-PICK asset verifier/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isImage(buffer)) throw new Error("Response is not a supported image file");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      if (hashes.has(hash)) throw new Error(`Duplicate image of ${hashes.get(hash)}`);
      hashes.set(hash, record.universityId);
      const relativeFile = record.imageFile || record.logoFile;
      if (!relativeFile || relativeFile.includes("..")) throw new Error("Invalid local asset path");
      const destination = path.resolve(root, relativeFile);
      if (!destination.startsWith(root + path.sep)) throw new Error("Asset path escapes project root");
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, buffer);
      await pause(1200);
    } catch (error) {
      errors.push({ universityId: record.universityId, message: error.message, checkedAt: new Date().toISOString() });
    }
  }
  await fs.writeFile(errorFile, `${JSON.stringify(errors, null, 2)}\n`);
  console.log(`Asset download complete: ${records.length - errors.length} checked, ${errors.length} failed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
