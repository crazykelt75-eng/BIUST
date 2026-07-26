# Live testing Kraal

How to walk the whole loop on a test deployment, before the SMS gateway and
R2 exist. Written for a tester, not a developer.

## The two escape hatches

Real deployments must never set these. A test deployment sets both:

| Variable | What it does |
|---|---|
| `ALLOW_CONSOLE_SMS=true` | OTP codes are written to the server log instead of sent by SMS. Read them with `wrangler tail` (Workers) or from the console (`next start`). |
| `ALLOW_LOCAL_STORAGE=true` | Photos are written to local disk. **Only works where a disk exists** — `next start` on a VPS or locally. On Cloudflare Workers there is no disk; R2 is required even for testing. |

Both shout a warning on every use so they cannot be forgotten in a real deploy.

## Local test run

```bash
npm install
npx prisma migrate dev
SEED_ADMIN_PHONE=71000000 npm run db:seed   # zones + a test admin
npm run build && npx next start
```

`.env` needs `DATABASE_URL`, `DIRECT_URL`, `OTP_PEPPER`, and the two hatches.

## The loop to walk

1. **Sign up** at `/signin` with any Botswana-format mobile (`71 234 567`).
   The code is in the server log: `[sms:dev] +267712***67: Kraal: 123456…`
2. **Onboard** — you land on `/`, tap *Rekisa leruo* (Sell), get redirected to
   `/onboarding`. Register a farm, pick a zone, submit the two documents.
3. **Approve yourself** — sign in as the seeded admin (`71000000`) in another
   browser, open `/admin/verifications`, approve both documents. The farmer's
   tier moves T0 → T1 → T2.
4. **List** — back as the farmer: `/sell`. Three photos (camera or files), one
   animal with a LITS tag like `BW123456789`, a price. Publish.
5. **Second user** — sign up with a different number, farm + `NATIONAL_ID`
   doc, admin-approve (T1 can make offers; only listing needs T2).
6. **Offer** — open the listing from `/`, offer below asking, add a message.
7. **Accept** — as the seller, `/my` shows the offer with Accept/Decline.
   Accepting creates the transaction; the listing shows as sold; `/my` shows
   the deal for both parties.

## What to verify while walking

- Setswana by default; the toggle persists.
- LITS numbers are masked (`BW-****-6789`) on every public page.
- A second account listing the same LITS tag is refused and both listings freeze.
- Wrong OTP five times kills the code entirely — even the right code then fails.
- A fourth code request inside 15 minutes returns 429.
- Offering on your own listing is refused; accepting someone else's offer is refused.
- Photos come back with no EXIF (check with `exiftool` — should be empty).

## What is NOT in this draft

No escrow payment flow in the UI (the ledger and services exist; no payment
rail is connected). No alert push delivery (matches are computed and logged in
`alert_sends`). No photo resizing. Auctions deliberately absent (licence).
