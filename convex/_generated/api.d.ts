/* eslint-disable */
/**
 * Bootstrap Convex generated API types.
 * Automatically regenerated when you link a deployment via `npx convex dev`.
 */
import type * as automation from "../automation.js";
import type * as http from "../http.js";
import type * as loans from "../loans.js";
import type * as security from "../security.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  automation: typeof automation;
  http: typeof http;
  loans: typeof loans;
  security: typeof security;
  tools: typeof tools;
  users: typeof users;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
