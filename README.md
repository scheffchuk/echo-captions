# Echo

Live multilingual captions for talks. You speak; the audience reads in their language.

An operator signs in, creates a session, goes live, and shares a `/view/{slug}` link. [ElevenLabs Scribe](https://elevenlabs.io/) transcribes. [Google Cloud Translation](https://cloud.google.com/translate) captions for the audience languages you choose (typically English, Chinese, and Japanese). Viewers need no account.

One Convex deploy shares one ElevenLabs key and one Google service account. Every operator on that deploy uses that bill.

## Self-host

Requirements: Node 22+, pnpm, a [Convex](https://convex.dev) project, an ElevenLabs API key, and a Google Cloud project with Cloud Translation enabled.

```bash
pnpm install
cp example.env.local .env.local
npx convex dev
```

Fill `.env.local` from `example.env.local`. Set Convex env vars with `npx convex env set`:

```bash
npx convex env set ELEVENLABS_API_KEY=…
npx convex env set GOOGLE_CLOUD_PROJECT_ID=…
npx convex env set GOOGLE_APPLICATION_CREDENTIALS_JSON=…
```

`GOOGLE_APPLICATION_CREDENTIALS_JSON` is the full service-account JSON string. Grant that account **Cloud Translation API User**.

Then:

```bash
pnpm dev
```

Open the app, create the first account (email + password), and go live.

## Accounts

- Email + password. No email verification. No password reset.
- The first account on a deploy can always sign up.
- Later signups stay closed unless you set `ALLOW_SIGNUP=true` in Convex env.
- Each operator owns only their sessions. Audience links stay public.

If you lose the password, change the user from the Convex dashboard. There is no mailer.

Production: do not set `ALLOW_SIGNUP`. Create your account (first user), then leave the flag unset.

Schema note: this tree drops the old `operatorSetup` table. On an existing Convex project, delete leftover `operatorSetup`, `users`, `authAccounts`, and `authSessions` documents before deploying, or the abandoned operator row will block first signup.

## License

MIT. See `LICENSE`.
