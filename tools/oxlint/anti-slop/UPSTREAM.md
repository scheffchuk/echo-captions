# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`.

Every copied plugin file matches `skills/install-anti-slop/assets/anti-slop` at that commit. This file is the local provenance record and is not part of that snapshot. The snapshot matches upstream `src/` except the `src/**/*.test.ts` files, which the skill bundle does not include.

Installed entry points:

- `tools/oxlint/anti-slop/index.ts` (`anti-slop`)
- `tools/oxlint/anti-slop/effect/index.ts` (`anti-slop-effect`)

Nested ESLint Stylistic provenance stays in `vendor/eslint-stylistic/UPSTREAM.md` (commit `435c3ea0fd26a5fef9042c4b36b6e165fbbf8d08`).

## Local deviations

- `oxlint` and `@oxlint/plugins` are pinned at `1.85.0`, the current registry pair when this copy was installed. Upstream's own manifest pins `1.78.0`.
- The Effect plugin is enabled because `effect` is a direct dependency.
- `biome.json` ignores this directory so the repository formatter does not rewrite vendored bytes.
- `tsconfig.json` excludes this directory. The plugin imports `.ts` files for Oxlint's loader; the app compiler does not.

`anti-slop-effect/no-service-constructor-imports` only sees relative `./` and `../` imports. `@/*` imports are outside the rule.
