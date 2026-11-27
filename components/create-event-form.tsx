import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { Match, Schema } from "effect";
import {
	CalendarIcon,
	Check,
	ChevronLeft,
	ChevronRight,
	Plus,
	X,
} from "lucide-react";
import { useState } from "react";
import { LabelWithHint } from "@/components/label-with-hint";
import { TranslationMappingsField } from "@/components/translation-mappings-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandItemText,
	CommandList,
} from "@/components/ui/command";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { getPublicConvexError } from "@/lib/expected-errors";
import { getCommonLanguageName } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { COMMON_LANGUAGES, MAX_SPOKEN_LANGUAGES } from "@/shared/languages";
import {
	createTranslationMappingDraft,
	projectTranslationMappingDraft,
	type TranslationMappingDraftIssueCode,
} from "@/src/lib/translationMappingDraft";

const eventNameSchema = Schema.String.pipe(
	Schema.check(Schema.isNonEmpty({ message: "Event name is required" })),
);

const spokenLanguagesSchema = Schema.Array(Schema.String).pipe(
	Schema.check(
		Schema.isMinLength(1, { message: "Add at least one spoken language" }),
	),
	Schema.check(
		Schema.isMaxLength(MAX_SPOKEN_LANGUAGES, {
			message: `At most ${MAX_SPOKEN_LANGUAGES} spoken languages`,
		}),
	),
);

const formSchema = Schema.Struct({
	eventName: eventNameSchema,
	eventDescription: Schema.Trim,
	eventDate: Schema.optional(Schema.Date),
	spokenLanguages: spokenLanguagesSchema,
	audienceLanguagesExtra: Schema.Array(Schema.String),
	translationMappings: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			term: Schema.Trim,
			targetLanguage: Schema.Trim,
			translation: Schema.Trim,
		}),
	),
});

const formValidator = Schema.toStandardSchemaV1(formSchema);

const eventNameValidator = Schema.toStandardSchemaV1(eventNameSchema);

const spokenLanguagesValidator = Schema.toStandardSchemaV1(
	spokenLanguagesSchema,
);

type FormValues = Schema.Schema.Type<typeof formSchema>;

const DEFAULT_FORM_VALUES: FormValues = {
	eventName: "",
	eventDescription: "",
	eventDate: undefined,
	spokenLanguages: ["en"],
	audienceLanguagesExtra: [],
	translationMappings: [],
};

class TranslationMappingInputError extends Error {}

function createSessionInput(values: FormValues) {
	const decoded = Schema.decodeUnknownSync(formSchema)(values);

	const audienceCodes = Array.from(
		new Set([...decoded.spokenLanguages, ...decoded.audienceLanguagesExtra]),
	);

	const mappingInput = projectTranslationMappingDraft(
		createTranslationMappingDraft({ rows: decoded.translationMappings }),
		audienceCodes,
	);

	if (!mappingInput.ok) {
		throw new TranslationMappingInputError(
			mappingInput.issues.map(mappingIssueMessage).join(" "),
		);
	}

	return {
		title: decoded.eventName.trim() || "Untitled",
		description: decoded.eventDescription || undefined,
		eventDate: decoded.eventDate?.getTime(),
		spokenLanguages: [...decoded.spokenLanguages],
		audienceLanguagesExtra: [...decoded.audienceLanguagesExtra],
		translationMappings: mappingInput.mappings,
	};
}

function mappingIssueMessage(issue: {
	code: TranslationMappingDraftIssueCode;
}): string {
	switch (issue.code) {
		case "incomplete_row":
			return "Complete each translation mapping or remove the row.";
		case "invalid_audience_language":
			return "Choose an Audience language for each translation mapping.";
		case "duplicate_mapping":
			return "Each term can have only one mapping per language.";
		case "term_too_long":
			return "Mapping terms must be 200 Unicode characters or fewer.";
		case "translation_too_long":
			return "Mapping replacements must be 200 Unicode characters or fewer.";
		case "too_many_mappings":
			return "At most 100 translation mappings are allowed.";
		case "conflict":
			return "Reload the glossary before saving.";
	}
}

type CreateSession = (
	input: ReturnType<typeof createSessionInput>,
) => Promise<{ slug: string }>;

function useCreateEventForm(
	createSession: CreateSession,
	onCreated: (slug: string) => void,
) {
	return useForm({
		defaultValues: DEFAULT_FORM_VALUES,
		validators: { onSubmit: formValidator },
		onSubmit: async ({ value, formApi }) => {
			formApi.setErrorMap({ onSubmit: undefined });

			try {
				const { slug } = await createSession(createSessionInput(value));
				onCreated(slug);
			} catch (err) {
				if (err instanceof TranslationMappingInputError) {
					formApi.setErrorMap({
						onSubmit: {
							form: err.message,
							fields: {},
						},
					});

					return;
				}

				const failure = getPublicConvexError(err, "Couldn't create event");
				formApi.setErrorMap({
					onSubmit: {
						form: failure.message,
						fields: {},
					},
				});
				throw err;
			}
		},
	});
}

type CreateEventFormApi = ReturnType<typeof useCreateEventForm>;

type FormFieldMessage = string | { message: string };

type SubmitError = { form?: FormFieldMessage } | FormFieldMessage;

function validationErrorMessage(error: FormFieldMessage): string {
	return Match.value(error).pipe(
		Match.when(Schema.is(Schema.String), (text) => text),
		Match.orElse((value) => value.message),
	);
}

function fieldErrorMessage(
	errors: ReadonlyArray<FormFieldMessage | undefined>,
): string | undefined {
	const error = errors[0];

	if (error === undefined) return undefined;

	return validationErrorMessage(error);
}

function getFormErrorMessage(
	error: SubmitError | undefined,
): string | undefined {
	if (error === undefined) return undefined;

	return Match.value(error).pipe(
		Match.when(Schema.is(Schema.String), (text) => text),
		Match.when(
			Schema.is(Schema.Struct({ message: Schema.String })),
			(value) => value.message,
		),
		Match.orElse((value) =>
			value.form === undefined ? undefined : validationErrorMessage(value.form),
		),
	);
}

const STEPS = [
	{
		title: "Event details",
		description: "Name your talk. Description and date are optional.",
		fields: ["eventName"] as const,
	},
	{
		title: "Languages",
		description: "What you’ll speak. Audience captions match by default.",
		fields: ["spokenLanguages"] as const,
	},
];

const QUICK_AUDIENCE_CODES = ["en", "zh", "ja", "ko", "es", "fr"] as const;

const STEP_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

function stepEnterClass(direction?: number): string {
	return cn(
		"animate-in fade-in duration-200 fill-mode-backwards motion-reduce:animate-none",
		direction !== undefined &&
			(direction >= 0 ? "slide-in-from-right-3" : "slide-in-from-left-3"),
	);
}

function StepPanel({
	step,
	direction,
	children,
}: {
	step: number;
	direction: number;
	children: React.ReactNode;
}) {
	return (
		<div
			key={step}
			className={cn("w-full", stepEnterClass(direction))}
			style={{ animationTimingFunction: STEP_EASE }}
		>
			{children}
		</div>
	);
}

export function CreateEventForm({
	triggerVariant = "primary",
	onCreated,
}: {
	triggerVariant?: "primary" | "outline";
	onCreated: (slug: string) => void;
}) {
	const createSession = useMutation(api.sessions.create);

	return (
		<CreateEventFormView
			triggerVariant={triggerVariant}
			createSession={createSession}
			onCreated={onCreated}
		/>
	);
}

export function CreateEventFormView({
	triggerVariant = "primary",
	createSession,
	onCreated,
}: {
	triggerVariant?: "primary" | "outline";
	createSession: CreateSession;
	onCreated: (slug: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [currentStep, setCurrentStep] = useState(0);
	const [direction, setDirection] = useState(1);

	const form = useCreateEventForm(createSession, (slug) => {
		setOpen(false);
		reset();
		onCreated(slug);
	});

	const reset = () => {
		form.reset(DEFAULT_FORM_VALUES);
		setCurrentStep(0);
		setDirection(1);
	};

	const nextStep = async () => {
		const fields = STEPS[currentStep].fields;

		if (fields.length > 0) {
			const errors = await form.validateField(fields[0], "submit");

			if (errors.length > 0) return;
		}

		if (currentStep === STEPS.length - 1) {
			if (form.state.isSubmitting) return;
			void form.handleSubmit().catch((error) => {
				if (!(error instanceof ConvexError)) throw error;
			});

			return;
		}

		setDirection(1);
		setCurrentStep((s) => s + 1);
	};

	const prevStep = () => {
		if (currentStep === 0) return;
		setDirection(-1);
		setCurrentStep((s) => s - 1);
	};

	const isLastStep = currentStep === STEPS.length - 1;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);

				if (!next) reset();
			}}
		>
			<DialogTrigger
				render={
					<Button
						variant={triggerVariant === "outline" ? "outline" : undefined}
						className={
							triggerVariant === "primary"
								? "bg-echo-live text-echo-live-foreground hover:bg-echo-live/90"
								: undefined
						}
					/>
				}
			>
				<Plus className="size-4" />
				New event
			</DialogTrigger>
			<DialogContent
				className="gap-0 overflow-hidden p-0 sm:max-w-xl"
				showCloseButton={false}
			>
				<div>
					<div className="relative px-8 py-4">
						<div
							key={currentStep}
							aria-live="polite"
							aria-atomic="true"
							className={cn(
								"flex max-w-[calc(100%-6.5rem)] flex-col gap-2",
								stepEnterClass(),
							)}
							style={{ animationTimingFunction: STEP_EASE }}
						>
							<DialogTitle className="text-title">
								{STEPS[currentStep].title}
							</DialogTitle>
							<DialogDescription>
								{STEPS[currentStep].description}
							</DialogDescription>
						</div>
						<div className="absolute top-4 right-4 flex items-center gap-2">
							<Progress
								value={currentStep + 1}
								min={1}
								max={STEPS.length}
								aria-label={`Step ${currentStep + 1} of ${STEPS.length}`}
							>
								{STEPS.map((step, index) => (
									<div
										key={step.title}
										aria-hidden
										className={cn(
											"h-2 rounded-full transition-[width,background-color] duration-200 ease-out",
											currentStep === index
												? "w-8 bg-echo-live"
												: "w-2 bg-muted",
										)}
									/>
								))}
							</Progress>
							<DialogClose className="rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
								<X />
								<span className="sr-only">Close</span>
							</DialogClose>
						</div>
					</div>

					<div className="relative overflow-hidden border-y">
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<fieldset
									disabled={isSubmitting}
									className="m-0 min-w-0 border-0"
								>
									<div className="px-8 py-4">
										<StepPanel step={currentStep} direction={direction}>
											{currentStep === 0 && <StepEventDetails form={form} />}
											{currentStep === 1 && <StepLanguages form={form} />}
										</StepPanel>
									</div>
								</fieldset>
							)}
						</form.Subscribe>
					</div>

					<div className="flex flex-col gap-4 px-8 py-4">
						<form.Subscribe selector={(state) => state.errorMap.onSubmit}>
							{(submitError) => {
								const message = getFormErrorMessage(submitError);

								return message ? (
									<p role="alert" className="text-sm text-destructive">
										{message}
									</p>
								) : null;
							}}
						</form.Subscribe>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<div className="flex items-center justify-between">
									<Button
										variant="secondary"
										type="button"
										onClick={prevStep}
										disabled={currentStep === 0 || isSubmitting}
									>
										<ChevronLeft className="size-4" />
										Back
									</Button>
									<Button
										type="button"
										onClick={() => void nextStep()}
										disabled={isSubmitting}
										className={
											isLastStep
												? "bg-echo-live text-echo-live-foreground hover:bg-echo-live/90"
												: undefined
										}
									>
										{isLastStep ? (
											<>
												{isSubmitting ? "Creating…" : "Create event"}
												<Check className="size-4" />
											</>
										) : (
											<>
												Next
												<ChevronRight className="size-4" />
											</>
										)}
									</Button>
								</div>
							)}
						</form.Subscribe>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function StepEventDetails({ form }: { form: CreateEventFormApi }) {
	return (
		<div className="space-y-4">
			<form.Field
				name="eventName"
				validators={{ onSubmit: eventNameValidator }}
			>
				{(field) => (
					<Field>
						<FieldLabel htmlFor={field.name}>Event Name</FieldLabel>
						<Input
							id={field.name}
							name={field.name}
							placeholder="e.g. Author Talk: The Night Library"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
						<FieldError>
							{fieldErrorMessage(field.state.meta.errors)}
						</FieldError>
					</Field>
				)}
			</form.Field>

			<form.Field name="eventDescription">
				{(field) => (
					<Field>
						<FieldLabel htmlFor={field.name}>Event Description</FieldLabel>
						<Textarea
							id={field.name}
							name={field.name}
							placeholder="Brief description of the event"
							className="min-h-24"
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
					</Field>
				)}
			</form.Field>

			<form.Field name="eventDate">
				{(field) => {
					const eventDate = field.state.value;

					return (
						<EventDateField
							name={field.name}
							value={eventDate}
							onChange={(date) => field.handleChange(date)}
						/>
					);
				}}
			</form.Field>
		</div>
	);
}

function EventDateField({
	name,
	value,
	onChange,
}: {
	name: string;
	value: Date | undefined;
	onChange: (date: Date | undefined) => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Field>
			<Label htmlFor={name}>Event Date</Label>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={
						<Button
							id={name}
							variant="outline"
							className={cn(
								"w-full justify-start text-left font-normal",
								!value && "text-muted-foreground",
							)}
						/>
					}
				>
					<CalendarIcon className="mr-2 size-4" />
					{value ? (
						value.toLocaleDateString(undefined, {
							dateStyle: "long",
						})
					) : (
						<span>Pick a date</span>
					)}
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar
						selected={value}
						onSelect={(next) => {
							onChange(next);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
		</Field>
	);
}

function StepLanguages({ form }: { form: CreateEventFormApi }) {
	const [showAudienceExtras, setShowAudienceExtras] = useState(
		() => form.getFieldValue("audienceLanguagesExtra").length > 0,
	);

	return (
		<form.Field
			name="spokenLanguages"
			validators={{ onSubmit: spokenLanguagesValidator }}
		>
			{(spokenField) => (
				<form.Field name="audienceLanguagesExtra">
					{(extraField) => {
						const spoken = [...spokenField.state.value];
						const extra = [...extraField.state.value];

						const audienceSummary = spoken
							.map(getCommonLanguageName)
							.join(" · ");

						const quickAudience = QUICK_AUDIENCE_CODES.filter(
							(code) => !spoken.includes(code) && !extra.includes(code),
						);

						const audienceCodes = Array.from(new Set([...spoken, ...extra]));

						const addExtra = (code: string) => {
							if (spoken.includes(code) || extra.includes(code)) return;
							extraField.handleChange([...extra, code]);
							setShowAudienceExtras(true);
						};

						return (
							<div className="space-y-6">
								<Field>
									<LabelWithHint
										label="Spoken languages"
										hint="Languages speakers will present in."
									/>
									<LanguageChips
										selected={spoken}
										onRemove={(code) =>
											spokenField.handleChange(spoken.filter((c) => c !== code))
										}
										addButton={
											<AddLanguageButton
												disabledCodes={spoken}
												disabled={spoken.length >= MAX_SPOKEN_LANGUAGES}
												onAdd={(code) =>
													spokenField.handleChange([...spoken, code])
												}
											/>
										}
									/>
									<FieldError>
										{fieldErrorMessage(spokenField.state.meta.errors)}
									</FieldError>
								</Field>

								<div className="space-y-3 rounded-xl bg-muted/40 px-4 py-3">
									<p className="text-sm text-muted-foreground text-pretty">
										Audience will read{" "}
										<span className="font-medium text-foreground">
											{audienceSummary || "your spoken languages"}
										</span>
										{extra.length === 0 ? " by default." : "."}
									</p>

									{!showAudienceExtras ? (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-auto px-0 text-echo-live hover:bg-transparent hover:text-echo-live/80"
											onClick={() => setShowAudienceExtras(true)}
										>
											Add another audience language
										</Button>
									) : (
										<div className="space-y-3">
											<p className="text-sm font-medium">
												Also offer captions in
											</p>
											{quickAudience.length > 0 ? (
												<div className="flex flex-wrap gap-2">
													{quickAudience.map((code) => (
														<Button
															key={code}
															type="button"
															size="sm"
															variant="outline"
															className="border-dashed"
															onClick={() => addExtra(code)}
														>
															<Plus className="size-4" />
															{getCommonLanguageName(code)}
														</Button>
													))}
												</div>
											) : null}
											<LanguageChips
												selected={extra}
												onRemove={(code) =>
													extraField.handleChange(
														extra.filter((c) => c !== code),
													)
												}
												addButton={
													<AddLanguageButton
														disabledCodes={[...spoken, ...extra]}
														onAdd={addExtra}
													/>
												}
											/>
										</div>
									)}
								</div>

								<form.Field name="translationMappings">
									{(mappingField) => {
										const projection = projectTranslationMappingDraft(
											createTranslationMappingDraft({
												rows: [...mappingField.state.value],
											}),
											audienceCodes,
										);

										const issues = projection.ok ? [] : projection.issues;

										return (
											<TranslationMappingsField
												mappings={mappingField.state.value}
												audienceCodes={audienceCodes}
												issues={issues}
												onChange={(mappings) =>
													mappingField.handleChange(mappings)
												}
											/>
										);
									}}
								</form.Field>
							</div>
						);
					}}
				</form.Field>
			)}
		</form.Field>
	);
}

function LanguageChips({
	selected,
	onRemove,
	addButton,
}: {
	selected: string[];
	onRemove: (code: string) => void;
	addButton: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{addButton}
			{selected.map((code) => (
				<Badge
					key={code}
					variant="secondary"
					className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
				>
					{getCommonLanguageName(code)}
					<button
						type="button"
						className="inline-flex size-4 items-center justify-center hover:text-destructive"
						aria-label={`Remove ${getCommonLanguageName(code)}`}
						onClick={() => onRemove(code)}
					>
						<X className="size-3.5" />
					</button>
				</Badge>
			))}
		</div>
	);
}

function AddLanguageButton({
	disabledCodes,
	onAdd,
	disabled = false,
}: {
	disabledCodes: string[];
	onAdd: (code: string) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);

	const available = COMMON_LANGUAGES.filter(
		(lang) => !disabledCodes.includes(lang.code),
	);

	return (
		<Popover open={open} onOpenChange={setOpen} modal>
			<PopoverTrigger
				disabled={disabled || available.length === 0}
				render={
					<Button
						variant="outline"
						size="sm"
						className="border-dashed text-muted-foreground"
					/>
				}
			>
				<Plus className="size-4" />
				Add language
			</PopoverTrigger>
			<PopoverContent className="w-56 p-0" align="start">
				<Command
					onAction={(code) => {
						onAdd(code);
						setOpen(false);
					}}
				>
					<CommandInput
						aria-label="Search language"
						placeholder="Search language..."
					/>
					<CommandEmpty>No language found.</CommandEmpty>
					<CommandList>
						<CommandGroup>
							{available.map((lang) => (
								<CommandItem
									key={lang.code}
									value={lang.code}
									label={lang.name}
								>
									<CommandItemText />
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
