"use strict";

const crypto = require("crypto");

function createHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

module.exports = { createHash };
