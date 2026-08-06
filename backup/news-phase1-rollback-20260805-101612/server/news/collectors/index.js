"use strict";

async function collectUniversityNews() {
  return { skipped: true, reason: "News collection is disabled in phase 1." };
}

module.exports = { collectUniversityNews };
