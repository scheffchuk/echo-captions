import { CircleHelp } from "lucide-react";
import { FieldLabel } from "@/components/ui/field";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export function LabelWithHint({
	htmlFor,
	label,
	hint,
}: {
	htmlFor?: string;
	label: string;
	hint: string;
}) {
	return (
		<FieldLabel htmlFor={htmlFor} className="inline-flex items-center gap-2">
			{label}
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						tabIndex={-1}
						className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
						aria-label={hint}
					>
						<CircleHelp className="size-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="right" className="max-w-56">
					{hint}
				</TooltipContent>
			</Tooltip>
		</FieldLabel>
	);
}
