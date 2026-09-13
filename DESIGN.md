---
name: Echo
description: Live multilingual captions — restrained white product UI with a single live accent
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.45 0 0)"
  border: "oklch(0.922 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  echo-live: "oklch(0.58 0.14 45)"
  echo-live-foreground: "oklch(0.99 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  background-dark: "oklch(0.145 0 0)"
  foreground-dark: "oklch(0.985 0 0)"
  echo-live-dark: "oklch(0.72 0.12 45)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "calc(0.625rem - 4px)"
  md: "calc(0.625rem - 2px)"
  lg: "0.625rem"
  xl: "calc(0.625rem + 4px)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "40px"
components:
  button-live:
    backgroundColor: "{colors.echo-live}"
    textColor: "{colors.echo-live-foreground}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
  surface-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
---

# Design

## Overview

Echo is a **product** tool: operators run live caption sessions; audiences read. Visual strategy is **Restrained** — pure white / chroma-0 gray neutrals, one accent (`echo-live`) for live *state* (badges, dashboard continue/launchpad). Broadcast “Go live” stays labeled primary black — calm under pressure, not orange-drenched. Warmth is voice and behavior, not a tinted canvas. shadcn/ui + Geist Sans/Mono. Prefer familiarity and calm density over decorative brand theater.

Source of truth for tokens: `app/globals.css` (`:root` / `.dark`). Keep new screens aligned with that file.

## Colors

**Strategy: Restrained white.** Neutrals use **chroma 0** (true white / gray). Do not tint body, card, muted, or accent surfaces toward warmth (no cream, sand, parchment, or hue-45 wash on the shell).

| Role | Token | Notes |
|------|--------|--------|
| Background | `--background` `oklch(1 0 0)` | Pure white light; near-black dark |
| Ink | `--foreground` | High-contrast text |
| Surfaces | `--card`, `--muted`, `--secondary` | Flat neutrals; subtle separation via border/ring |
| Live accent | `--echo-live` | Sole chromatic state color — LIVE badge, dashboard continue-broadcast / launchpad tint. Not the broadcast Go live button. |
| Destructive | `--destructive` | Errors and delete only |

Dark mode mirrors the same restraint: chroma-0 neutrals; slightly brighter `--echo-live` for contrast.

Viewer surfaces may use `.viewer-light` / `.viewer-high-contrast` overrides for caption reading; still no warm shell tint.

## Typography

One family: **Geist** (`--font-geist-sans`) with Geist Mono for technical bits. Product UI: prefer `text-title` over `text-display` on app shells (dashboard); reserve display scale for login/marketing-adjacent moments. Caption reading uses `--text-caption` / caption foreground tokens. Use `text-pretty` / `text-balance` on longer copy.

## Elevation

Mostly flat. Hierarchy via **rings** (`ring-1 ring-foreground/10`), borders, and tonal fills (`bg-muted`, live `bg-echo-live/8` only on live launchpad). Avoid heavy multi-layer shadows and glassmorphism.

## Components

- **Buttons**: shadcn variants. Dashboard continue-while-live = `bg-echo-live text-echo-live-foreground`. Broadcast Go live = labeled `default` (primary black); Stop = `destructive`. When an event is live, demote “New event” to outline.
- **Dashboard**: Sparse copy — wordmark only (no subtitle), short CTAs (`Continue`, `Share`). Launchpad when live; compact idle rows; labeled actions.
- **Broadcast**: Labeled Go live / Stop; live header is LIVE + More (Copy link, QR, Glossary). Idle mobile uses labeled Share sheet.
- **Dialogs / forms**: Create event is two steps (details → languages); glossary lives post-create in broadcast tools.
- **Live badge**: `--echo-live` fill; pulse is decorative; “LIVE” text carries meaning.

## Do's and Don'ts

**Do**
- Keep body and chrome chroma-0 (restrained white / gray).
- Use `--echo-live` for live *state* (LIVE badge, dashboard continue/launchpad) — not the broadcast Go live control.
- Favor plain copy and clear labels over icon-only critical actions.
- Meet WCAG 2.2 AA; keep caption contrast strong.

**Don't**
- Tint the app shell warm (cream, sand, hue-shifted neutrals “for personality”).
- Spread chromatic color across inactive chrome or decorative cards.
- Reintroduce glossary or settings walls into the create critical path.
- Nest full-card links over action button hit targets.
