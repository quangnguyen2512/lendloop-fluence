/* eslint-disable */
/**
 * Bootstrap Convex generated DataModel types (derived directly from convex/schema.ts).
 * Automatically regenerated when you link a deployment via `npx convex dev` or `npx convex codegen`.
 */
import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
