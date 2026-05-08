# XBrainPro

An AI platform built with SvelteKit that provides access to 65+ AI models for text generation, image generation, video generation, and multimodal chat.

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Auth.js (SvelteKit) with email/password + OAuth
- **Payments**: Stripe + Opaybd (BDT support)
- **Storage**: Local filesystem (with optional Cloudflare R2)
- **AI**: OpenRouter (text), Replicate (images/video), ElevenLabs (audio)
- **i18n**: Paraglide JS (en, de, es, pt)

## Project Structure

```
src/
  app.html           - Root HTML template
  auth.ts            - Auth.js configuration
  hooks.server.ts    - SvelteKit server hooks
  lib/
    server/db/
      schema.ts      - Drizzle ORM schema
      index.ts       - Database connection
    components/      - Reusable UI components
    stores/          - Svelte state stores
    utils/           - Utility functions
  routes/            - SvelteKit file-based routing
    +layout.svelte   - Root layout
    +page.svelte     - Landing page
    admin/           - Admin dashboard routes
    api/             - API endpoints
```

## Development Setup

- Runs on port **5000** (configured in vite.config.ts)
- Dev server: `npm run dev`
- DB migrations: `npx drizzle-kit push --force`

## Required Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (auto-set by Replit)
- `AUTH_SECRET` - Auth.js secret key
- `PUBLIC_ORIGIN` - Public URL of the app

## Optional Environment Variables (configurable via Admin Dashboard)

- `OPENROUTER_API_KEY` - For text AI models
- `REPLICATE_API_TOKEN` - For image/video models
- `STRIPE_SECRET_KEY` / `PUBLIC_STRIPE_PUBLISHABLE_KEY` - Payments
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` - Google OAuth
- SMTP settings for email
- Cloudflare R2 for cloud storage
- `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` - Bot protection

## Admin Features

- **App Update**: Admin panel includes an "App Update" page at `/admin/settings/app-update` where admins can upload a zip file to update app code while preserving database, env vars, uploads, and settings. The endpoint includes path traversal protection, symlink rejection, and rollback on npm install failure.
- **Landing Page Settings**: Admin panel at `/admin/settings/landing` allows editing all landing page text content (hero, features, pricing section text, CTA, FAQs, footer). Content is stored in the `admin_settings` table under category `'landing'`. The public landing page (`+page.svelte`) loads content from DB with hardcoded fallback defaults. Pricing plans on the landing page are loaded dynamically from the `pricingPlans` DB table via `getPricingPlans('month')`.

## Payment Integration

- **Stripe**: Default payment provider, supports USD
- **Opaybd**: Bangladesh payment gateway supporting BDT (bKash, Nagad, etc.)
- Active provider is set via Admin > Settings > Payment Methods (`activePaymentProvider` setting)
- Currency display is dynamic: shows ৳ (BDT) when Opaybd is active, $ (USD) for Stripe
- `priceAmountBdt` column on `pricing_plan` table stores BDT prices in paisa
- Opaybd subscriptions require manual renewal (tracked via `renewalRequired` on subscription table)
- `RenewalBanner` component shows renewal prompts in the main app layout
- Key files: `src/lib/server/opaybd.ts`, `src/lib/server/payment-router.ts`, `src/routes/api/opaybd/`

## Extra Credits System

- Users can purchase additional generation credits beyond their plan limits
- Credits are per-type (text, image, video, audio) and deducted oldest-first
- Plan limits are checked first; if exceeded, extra credits are used automatically
- DB tables: `credit_plan` (admin-defined packs), `user_credit` (purchased credits per user)
- Admin manages credit plans at `/admin/settings/credit-plans`
- Users view balances and purchase at `/settings/billing` (Extra Credits section)
- Purchase API: `POST /api/credits/purchase` routes to Stripe or Opaybd
- Key files: `src/lib/server/credit-service.ts`, `src/routes/api/credits/purchase/+server.ts`
- Pricing pages show feature names without exact limit numbers; usage page shows actual counts

## Email Template System

- Admin-editable HTML email templates for all system emails
- 8 templates total: welcome/verify, reset password, OTP verification, plan purchase, credit purchase, subscription expiry, plan upgrade, general notice
- Templates stored in `admin_settings` table (category: `email_templates`, key: `email_template_{name}`)
- DB value is JSON `{subject, html}`; falls back to filesystem HTML files in `sys-email-templates/` if not customized
- `EmailTemplateService` in `src/lib/server/email-templates.ts`: getTemplate, saveTemplate, resetTemplate, getTemplateList, getDefaultTemplate
- `EmailService` extended with 6 new send methods: sendOtpEmail, sendPlanPurchaseEmail, sendCreditPurchaseEmail, sendExpiryWarningEmail, sendPlanUpgradeEmail, sendNoticeEmail
- Admin UI at `/admin/settings/mailing` has two tabs: "SMTP Settings" and "Email Templates"
- Template editor supports subject editing, HTML editing, variable reference, restore default, and reset
- API endpoint: `GET /api/admin/email-template/[name]` loads full template data for the editor
- Key files: `src/lib/server/email-templates.ts`, `src/lib/server/email.ts`, `src/routes/admin/settings/mailing/`

## OTP Email Verification (Registration)

- OTP verification is togglable via Admin > Settings > Mailing (OTP Email Verification card)
- Setting key: `otp_verification_enabled` in `general` category, defaults to `false` (disabled)
- When disabled: new users are auto-verified at registration and can log in immediately
- When enabled: new users must verify email via 6-digit OTP code before they can log in
- Registration flow (when enabled): fill form → create user (unverified) → send OTP email → redirect to `/verify-otp?email=...` → enter code → email verified → redirect to login
- If an unverified user tries to register again, a new OTP is sent and they're redirected to verify
- DB table: `otp_code` (id, email, code, purpose, attempts, max_attempts, expires, verified, created_at)
- `OtpService` in `src/lib/server/otp-service.ts`: createOtp, verifyOtp, cleanupExpired
- OTP codes expire after 10 minutes, max 5 attempts per code
- Uses `sendOtpEmail` from email service with the `otp-verification` template
- `/verify-otp` page is standalone (no sidebar) — added to `isStandalonePage` in root layout
- Key files: `src/lib/server/otp-service.ts`, `src/routes/verify-otp/`, `src/routes/register/+page.server.ts`

## Prompt Suggestions Carousel

- Auto-scrolling single-line carousel of prompt suggestions on the new chat welcome screen
- Admin-manageable via `/admin/settings/prompt-suggestions` (add, edit, reorder, enable/disable)
- Stored in `admin_settings` table (category: `prompt_suggestions`, key: `prompt_suggestions`)
- Value is JSON array of `{id, text, prompt, order, isActive}` objects
- Default 4 suggestions provided if none saved in DB
- Public API: `GET /api/prompt-suggestions` returns active suggestions sorted by order
- Carousel auto-scrolls, pauses on hover/touch, shows edge gradients
- Key files: `src/lib/server/prompt-suggestions.ts`, `src/lib/components/chat/PromptTemplates.svelte`, `src/routes/admin/settings/prompt-suggestions/`

## Sidebar Layout

- Sidebar toggle uses a 3-line hamburger icon (MenuIcon) instead of PanelLeftIcon
- "New Chat" uses MessageCircleIcon; a separate CirclePlusIcon (+) button opens a popover menu
- The + popover contains only "New Chat"; Image & Video and Audio are standalone sidebar items
- Projects remains as a standalone sidebar item below a divider
- Key files: `src/lib/components/ChatSidebar.svelte`, `src/lib/components/ui/sidebar/sidebar-trigger.svelte`

## Pricing Plans

- Plans stored in `pricing_plan` table, managed via Admin > Settings > Plans
- Seed endpoint: `POST /api/admin/seed-pricing-plans` populates default plans
- Usage limits: text, image, video, audio, voice generation limits (null = unlimited, 0 = excluded)
- `voiceGenerationLimit` column tracks ElevenLabs voice feature limits per plan
- Plans displayed on `/pricing` page filtered by billing interval (monthly/yearly)
- Supports both Stripe (USD) and Opaybd (BDT) pricing
- Key files: `src/routes/pricing/`, `src/routes/admin/settings/plans/`, `src/lib/server/pricing-plans-seeder.ts`

## Voice Mode (Voice Input)

- Mic button in chat input toolbar for voice-to-text input
- Uses browser MediaRecorder API to capture audio (WebM/Opus or MP4)
- Sends recording to `/api/audio-transcription` (ElevenLabs Scribe v1) for speech-to-text
- Transcribed text placed in chat input for review/editing before sending
- Audio usage limits enforced via existing `UsageTrackingService` (checkUsageLimit + trackUsage for 'audio')
- VoiceModeState class (Svelte 5 runes) manages recording lifecycle, transcription, timers, cleanup
- Visual feedback: red pulse during recording with timer, spinner during transcription
- Key files: `src/lib/components/chat/voice-mode-state.svelte.ts`, `src/lib/components/chat/ChatInput.svelte`, `src/lib/components/ChatInterface.svelte`

## AI Personalization

- Users can set their profession and custom instructions in Settings > AI Personalization
- User's name (from profile), profession, and personal instructions are injected into every chat as a system message
- Custom instructions limited to 2000 characters, profession to 100 characters
- DB columns: `profession text` and `personalInstructions text` on `user` table
- Key files: `src/routes/settings/ai-personalization/`, `src/routes/api/chat-stream/+server.ts` (buildUserPersonalization function)

## Theme & Design System

- Blue-to-purple gradient theme matching the logo (indigo #6366f1 to purple #a855f7)
- CSS variables for gradients: `--gradient-start`, `--gradient-mid`, `--gradient-end` (different values for light/dark)
- Theme colors use OKLCH color space with hue ~270 (blue-purple range) for both light and dark modes
- Utility classes: `.btn-gradient` (filled gradient button with glow + hover shimmer), `.btn-gradient-outline` (outlined → fills on hover), `.text-gradient` (gradient text), `.glow-gradient` / `.glow-gradient-hover` (box-shadow glow), `.border-gradient` (gradient border via CSS masks)
- All primary CTA buttons (landing, login, register, pricing) use `btn-gradient`
- Pricing toggle/badge use indigo-purple gradients; feature cards have blue-purple gradient icons

## Backups

- `opaybd-backup/` - Archived Opaybd payment integration files for reference
- `opaybd-backup.tar.gz` - Compressed archive of the same

## Deployment

Uses `@sveltejs/adapter-node`. Build with `npm run build`, run with `node build/index.js`.
