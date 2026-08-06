"use strict";

function getDatabaseStatus() {
  return { configured: Boolean(process.env.DATABASE_URL), connected: false, driver: "not-initialized" };
}

module.exports = { getDatabaseStatus };
