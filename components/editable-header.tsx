"use client";

import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export function EditableHeader({
	title,
	description,
	onTitleChange,
	onDescriptionChange,
	disabled = false,
	compact = false,
	actions,
}: {
	title: string;
	description?: string;
	onTitleChange?: (title: string) => void;
	onDescriptionChange?: (description: string) => void;
	disabled?: boolean;
	compact?: boolean;
	actions?: ReactNode;
}) {
	const [editingField, setEditingField] = useState<
		"title" | "description" | null
	>(null);
	const [draftTitle, setDraftTitle] = useState(title);
	const [draftDescription, setDraftDescription] = useState(description ?? "");

	const focusTitleInput = (el: HTMLInputElement | null) => {
		if (el) {
			el.focus();
			el.select();
		}
	};

	const focusDescriptionInput = (el: HTMLInputElement | null) => {
		if (el) {
			el.focus();
			el.select();
		}
	};

	const startEditingTitle = () => {
		if (disabled) return;
		setDraftTitle(title);
		setEditingField("title");
	};

	const startEditingDescription = () => {
		if (disabled || !onDescriptionChange) return;
		setDraftDescription(description ?? "");
		setEditingField("description");
	};

	const commitTitle = () => {
		setEditingField(null);
		const nextTitle = draftTitle.trim() || "Untitled";
		if (nextTitle !== title) {
			onTitleChange?.(nextTitle);
		}
	};

	const commitDescription = () => {
		setEditingField(null);
		const nextDescription = draftDescription.trim();
		if (nextDescription !== (description ?? "")) {
			onDescriptionChange?.(nextDescription);
		}
	};

	const handleTitleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commitTitle();
		}
		if (e.key === "Escape") {
			setEditingField(null);
		}
	};

	const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			commitDescription();
		}
		if (e.key === "Escape") {
			setEditingField(null);
		}
	};

	const titleClass = compact
		? "text-title font-bold"
		: "text-display font-bold leading-tight";
	const inputTitleClass = cn(
		titleClass,
		"w-full border-b border-border bg-transparent outline-none",
	);

	return (
		<div className="space-y-2">
			{editingField === "title" ? (
				<input
					ref={focusTitleInput}
					type="text"
					value={draftTitle}
					onChange={(e) => setDraftTitle(e.target.value)}
					onBlur={commitTitle}
					onKeyDown={handleTitleKeyDown}
					disabled={disabled}
					className={inputTitleClass}
					aria-label="Session title"
				/>
			) : (
				<h1 className={cn(titleClass, "mb-0")}>
					<button
						type="button"
						onClick={startEditingTitle}
						disabled={disabled}
						className={cn(
							"group flex w-fit max-w-full items-center gap-2 border-b border-transparent text-left transition-colors",
							disabled
								? "cursor-default"
								: "cursor-pointer hover:border-border hover:text-muted-foreground",
						)}
					>
						<span className="truncate">{title.trim() || "Untitled"}</span>
						{!disabled ? (
							<Pencil
								className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
								aria-hidden
							/>
						) : null}
					</button>
				</h1>
			)}
			{onDescriptionChange ? (
				editingField === "description" ? (
					<input
						ref={focusDescriptionInput}
						type="text"
						value={draftDescription}
						onChange={(e) => setDraftDescription(e.target.value)}
						onBlur={commitDescription}
						onKeyDown={handleDescriptionKeyDown}
						disabled={disabled}
						className="block w-full border-b border-border bg-transparent p-0 text-base leading-normal text-muted-foreground outline-none"
					/>
				) : (
					<button
						type="button"
						onClick={startEditingDescription}
						disabled={disabled}
						className={cn(
							"w-fit max-w-full text-left text-base leading-normal text-muted-foreground",
							disabled
								? "cursor-default"
								: "cursor-pointer border-b border-transparent transition-colors hover:border-border hover:text-foreground",
						)}
					>
						{description?.trim() || "Add a description"}
					</button>
				)
			) : null}
			{actions ? (
				<div className="mt-4 flex flex-wrap items-end justify-end gap-2">
					{actions}
				</div>
			) : null}
		</div>
	);
}
