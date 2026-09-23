import type { Id, TableNames } from "@/convex/_generated/dataModel";

export function testId<TableName extends TableNames>(
	_table: TableName,
	value: string,
): Id<TableName> {
	// SAFETY: fixture strings stand in for Convex ids in tests that do not read the document.
	return value as Id<TableName>;
}
