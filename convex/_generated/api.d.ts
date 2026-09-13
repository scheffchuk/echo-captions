/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as broadcasts from "../broadcasts.js";
import type * as captions from "../captions.js";
import type * as effect_config from "../effect/config.js";
import type * as effect_convex from "../effect/convex.js";
import type * as effect_run from "../effect/run.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_broadcasts from "../lib/broadcasts.js";
import type * as lib_captionRetry from "../lib/captionRetry.js";
import type * as lib_googleTranslate from "../lib/googleTranslate.js";
import type * as lib_languages from "../lib/languages.js";
import type * as lib_scribeClient from "../lib/scribeClient.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_signupPolicy from "../lib/signupPolicy.js";
import type * as lib_translationMappings from "../lib/translationMappings.js";
import type * as mappingRevisions from "../mappingRevisions.js";
import type * as scribe from "../scribe.js";
import type * as segments from "../segments.js";
import type * as sessions from "../sessions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  broadcasts: typeof broadcasts;
  captions: typeof captions;
  "effect/config": typeof effect_config;
  "effect/convex": typeof effect_convex;
  "effect/run": typeof effect_run;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/broadcasts": typeof lib_broadcasts;
  "lib/captionRetry": typeof lib_captionRetry;
  "lib/googleTranslate": typeof lib_googleTranslate;
  "lib/languages": typeof lib_languages;
  "lib/scribeClient": typeof lib_scribeClient;
  "lib/sessions": typeof lib_sessions;
  "lib/signupPolicy": typeof lib_signupPolicy;
  "lib/translationMappings": typeof lib_translationMappings;
  mappingRevisions: typeof mappingRevisions;
  scribe: typeof scribe;
  segments: typeof segments;
  sessions: typeof sessions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  captionWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"captionWorkpool">;
};
