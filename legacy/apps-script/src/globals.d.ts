// Project-level cross-file globals.
//
// Apps Script's V8 runtime executes all script files in one shared global
// scope, so `const Module = {...}` declared in any src/*.js is visible from
// every other file. TypeScript parses each .js file independently, so the
// cross-file references would otherwise be reported as undefined.
//
// We declare each module namespace as ambient `any` here. This is intentional:
// the goal of TypeScript checkJs in this project is to catch Apps Script API
// misuse (via @types/google-apps-script), not cross-module type safety.
// Replacing `any` with proper types is a future improvement once the surface
// stabilizes (see docs/extending.md for the recipe).
//
// We use `var` instead of `const` here so that the corresponding
// `const Module = {...}` declarations in src/*.js do not conflict with
// these ambient declarations.

declare var Config: any;
declare var Domain: any;
declare var Storage: any;
declare var Fx: any;
declare var Smoke: any;

// Phase 2 placeholders — declared early so future references type-check
// against them without churning this file.
declare var AiClient: any;
declare var Gemini: any;
declare var OpenAi: any;
declare var Anthropic: any;

// Phase 3
declare var Web: any;

// Domain entity types. Source of truth for shape lives in JSDoc inside
// src/Domain.js; tsc cannot read @typedef from another file without an
// explicit `import` reference, so we mirror the names here as ambient `any`.
// Replace with proper interfaces once we want full type safety.
declare type Receipt = any;
declare type Item = any;
declare type Product = any;
declare type ParsedReceipt = any;
declare type ParsedItem = any;
