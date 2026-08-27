"use strict";

// Deliberately duplicated (NOT imported) from
// server/agent/screening/link-risk-heuristics.js's SIMPLE_FN_CALL_ONCLICK /
// SIMPLE_ID_ARG -- see .pipeline/spec.md "결정 사항 2" for why. Keep the
// same safety criteria as that module, plus a length cap this module adds
// (rejects opaque/encrypted tokens like a JWE blob even though their
// character set alone could otherwise pass).
//
// This module NEVER executes the onclick/attribute value it parses (no
// eval/new Function/vm). It only matches against fixed regular expressions
// and returns captured plain-text pieces for the caller to interpolate into
// a human-authored urlTemplate.

const SIMPLE_FN_CALL = /^([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*;?\s*$/;
// Real-world markup for this pattern almost always carries the call inside
// href="javascript:fn(args);" rather than a separate onclick attribute (no
// KHU/JBNU/GNU/Dankook sample found in this project puts the bare call in
// onclick). Stripping this one well-known, non-executing URI-scheme prefix
// before matching does not loosen SIMPLE_FN_CALL's own anchors: whatever
// remains after the strip must still be exactly "fn(args);" end-to-end, so
// anything appended after a real function call (another statement, a second
// javascript: URI, etc.) still fails the match.
const JAVASCRIPT_HREF_PREFIX = /^\s*javascript\s*:\s*/i;
// The quoted-argument branch deliberately allows a *zero*-length quoted
// string (e.g. the empty `catId` argument in the real, GET-verified
// Kyunghee University sample `view('322857','200265','','BMSR00044')`) --
// an empty value carries no unsafe content by definition. Length is capped
// at 64 chars (same rationale as RAW_ATTR_VALUE below) so a long opaque/
// encrypted token quoted as a function argument is rejected even though its
// character set alone (`[\w-]`) would otherwise pass.
const SIMPLE_CALL_ARG = /^(?:(\d+)|['"]([\w-]{0,64})['"]|(true|false))$/;
const RAW_ATTR_VALUE = /^[\w-]{1,64}$/;

const ALLOWED_DATA_ATTR_NAMES = new Set([
  "data-id",
  "data-url",
  "data-param",
  "data-nm",
  "data-no",
  "data-seq",
  "data-idx",
]);

/**
 * Parse a "functionName(arg1, arg2, ...)" expression without executing it.
 * Only accepts 0+ simple arguments: a bare number, a quoted token made of
 * ASCII word chars/hyphens only (0-64 chars, so an intentionally empty
 * argument such as `''` is allowed but an opaque long token is not), or a
 * bare `true`/`false` literal. Rejects nested parens, multiple statements,
 * string concatenation, and variable/property references.
 *
 * @param {string} expression e.g. "view('322857', '200265', '', 'BMSR00044')"
 *   or "javascript:view('322857');" (a leading javascript: URI prefix is
 *   stripped before matching, see JAVASCRIPT_HREF_PREFIX above)
 * @returns {{ fnName: string, args: string[] } | null}
 */
function parseSimpleFunctionCall(expression) {
  const withoutJsPrefix = String(expression || "").trim().replace(JAVASCRIPT_HREF_PREFIX, "");
  const match = withoutJsPrefix.match(SIMPLE_FN_CALL);
  if (!match) return null;
  const rawArgs = match[2].trim();
  const args = rawArgs ? rawArgs.split(",").map((arg) => arg.trim()) : [];
  const values = [];
  for (const arg of args) {
    const argMatch = arg.match(SIMPLE_CALL_ARG);
    if (!argMatch) return null;
    values.push(argMatch[1] ?? argMatch[2] ?? argMatch[3]);
  }
  return { fnName: match[1], args: values };
}

/**
 * Validate a raw (unquoted) attribute value such as a `data-id="216600"`
 * attribute value, for use as a URL-template interpolation source. Rejects
 * empty values, non-word/hyphen characters, and anything longer than 64
 * characters (opaque/encrypted tokens such as a JWE blob).
 *
 * @param {*} value
 * @returns {boolean}
 */
function isSafeRawAttrValue(value) {
  return RAW_ATTR_VALUE.test(String(value == null ? "" : value));
}

module.exports = { parseSimpleFunctionCall, isSafeRawAttrValue, ALLOWED_DATA_ATTR_NAMES };
