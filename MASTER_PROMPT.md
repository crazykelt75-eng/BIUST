# KRAAL — Farmer-to-Farmer & Butcher Livestock Marketplace
## Master Prompt & Product Specification

> **Working name:** Kraal (placeholder — the Southern African term for a livestock enclosure).
> **Status:** Founding specification. This document is the single source of truth for scoping,
> and is written to be handed directly to an AI coding agent, a dev team, or an investor.
> **Primary market:** Botswana, with a design that generalises to SADC (Namibia, Zambia,
> Zimbabwe, South Africa).

---

## 0. How to use this document

This file serves three audiences at once:

1. **As a master prompt** — Sections 1–12 can be pasted wholesale into a coding agent as the
   system specification. Section 13 contains the condensed, copy-paste build prompt.
2. **As a product spec** — Sections 4–9 define the behaviour a QA engineer would test against.
3. **As an architecture brief** — Sections 10–12 define the stack, data model, and rollout.

Where a decision has been made deliberately, it is marked **DECISION:** with the reasoning.
Where something is genuinely open, it is marked **OPEN:** and should be resolved before that
phase begins.

---

## 1. The problem, stated precisely

A farmer in Serowe with 40 head of tollies ready for market today has three bad options:

- **Sell to a speculator at the farm gate.** Fast, but the speculator knows the regional price
  and the farmer does not. The spread is routinely 20–35%.
- **Truck to a formal abattoir.** Better price, but requires a movement permit, transport the
  farmer may not own, and a minimum lot size that a smallholder cannot hit alone.
- **Wait for the next auction.** Fixed date, fixed venue, cost of holding and feeding in the
  meantime, and no guarantee a buyer for that class of animal turns up.

Meanwhile a butcher in Gaborone needs 15 head a month of a consistent grade, and cannot find a
reliable supply, so pays a middleman for the privilege. And a neighbouring farmer who wants to
expand his herd never learns the tollies down the road were available at all.

**The gap is not a lack of buyers or sellers. It is a lack of price transparency, trusted
counterparties, and a mechanism for small lots to aggregate into commercially viable ones.**

Kraal closes that gap with four mechanisms:

| Mechanism | What it solves |
|---|---|
| **Broadcast listings + targeted alerts** | The neighbour never hearing about the tollies |
| **Lot splitting & buyer syndicates** | Smallholders can't hit a buyer's minimum lot alone |
| **Escrow + verified identity + traceability** | Nobody trusts a stranger with 40 head of cattle |
| **Published realised-price index** | Farmers negotiating blind against professional buyers |

**The syndicate/"buy-in" mechanic is the differentiator.** Everything else is a classifieds
site. Section 6 specifies it in full.

---

## 2. Users and what each one actually wants

Build every screen against a named persona. If a feature serves none of these, cut it.

### 2.1 Seller-Farmer — "Mpho, 62, Serowe, 140 head communal + fenced"
Wants the best price without leaving the farm, and wants to be paid before the animals leave
the loading ramp. Has a smartphone but data is expensive and the signal drops. Does not read
long English text; the UI must work in **Setswana**.
- Post a listing in under 3 minutes, from photos taken on the spot.
- See what similar animals actually sold for last month.
- Not get scammed. Not lose animals to a buyer who "will pay next week".

### 2.2 Buyer-Farmer — "Kabelo, 38, Mahalapye, building a herd"
Wants breeding stock and weaners, is price-sensitive, and buys opportunistically.
- Be told the moment something matching his criteria appears within 150 km.
- Buy 8 head out of a 40-head lot without having to take all 40.
- Verify the animal is not stolen and is disease-cleared before he pays.

### 2.3 Butcher / Abattoir — "Tebogo, Gaborone, 20 head/month throughput"
Wants **predictable supply of a consistent grade**, not one-off bargains. This is the persona
most likely to pay a subscription.
- Post a standing requirement ("Want to Buy") and have farmers come to him.
- Lock a forward contract: 20 head/month, grade A, for 6 months.
- Reject on arrival if the animal doesn't match spec, without losing his deposit.

### 2.4 Feedlot Operator
Buys weaners in volume, sells finished animals. Both sides of the market. High volume,
needs bulk tooling — CSV import, API access, saved buying programmes.

### 2.5 Transporter — "Rra Motsumi, 2 trucks, 30-head capacity"
Currently finds work by phone and drives empty half the time.
- See loads needing movement on routes he already runs.
- Get paid through the platform so he isn't chasing farmers for money.

### 2.6 Veterinary Officer / DVS Inspector
**Not a customer — a compliance gate.** Read-mostly role.
- Verify a movement permit application against a real listing.
- Flag a listing in a zone under FMD restriction.

### 2.7 Auctioneer / Agent
Runs timed auctions on behalf of farmers who don't want to self-serve. Takes a commission.
A distribution channel, not a competitor — bring them onto the platform.

### 2.8 Platform Admin & Trust Officer
Verification queue, dispute resolution, fraud investigation, price-index curation.

---

## 3. Non-negotiable domain constraints

**These are the constraints that will sink a naive implementation.** A generic marketplace
template does not know about any of them.

### 3.1 Livestock traceability (LITS)
Botswana operates a mandatory bolus/ear-tag traceability system. Every bovine has a unique
identifier.

- **DECISION:** LITS ID is a **required field** on every individual cattle record. No LITS ID,
  no listing. This is the platform's single strongest anti-stock-theft control and its most
  defensible trust feature.
- Store it, display a masked version publicly (`BW-****-4471`), reveal in full only to a
  committed buyer after escrow funding.
- **OPEN:** Whether a direct DVS/LITS verification API is obtainable. Until then, verification
  is: photo of the tag in the ear + the number keyed in + a mismatch flag raised by the buyer
  on inspection. Design the interface so a real API can be swapped in behind it.

### 3.2 FMD zoning and movement permits
The country is divided into disease-control zones. Moving animals between zones requires a
permit from the Department of Veterinary Services, and during an outbreak, movement out of an
affected zone is **prohibited outright**.

- Every farm has a `zone_id`. Every listing inherits it.
- **The matching engine must be zone-aware.** A buyer in a green zone must not receive alerts
  for animals in a locked red zone. Showing them is worse than useless — it generates illegal
  trades and destroys the platform's standing with DVS.
- Listings display a **movement feasibility banner**: `✅ Same zone — no permit needed` /
  `⚠️ Cross-zone — permit required (est. 5–10 days)` / `⛔ Movement restricted — zone under
  FMD control as of {date}`.
- Admin can flag a zone as restricted; all affected listings auto-suspend and all parties in
  open transactions are notified with rollback options.
- **DECISION:** Zone restriction is a **hard block on the transaction state machine**, not a
  warning. A transaction cannot advance to `READY_FOR_COLLECTION` while a zone block is active.

### 3.3 Stock theft
This is the dominant fraud vector in the region and the reason farmers distrust strangers.
Controls, layered:

1. LITS ID required and cross-checked against previously listed/sold animals — **the same LITS
   ID appearing under two different sellers is an automatic hard flag** and freezes both
   listings pending review.
2. Registered brand/earmark photo on the farm profile.
3. Seller identity verification (Omang / national ID) before first sale.
4. Police clearance certificate upload supported and badged on the profile.
5. A **stolen-stock register**: any user can report a LITS ID as stolen. Reported IDs are
   blocked from listing platform-wide and matched against historical records.

### 3.4 Weight, grade, and the dispute that follows
Almost every livestock dispute is about weight or condition on arrival.

- Weight must be recorded with a **method**: `WEIGHBRIDGE` (with ticket photo), `SCALE`,
  `TAPE_ESTIMATE`, or `VISUAL_ESTIMATE`. Display the method next to the number, always.
- **DECISION: a mandatory tolerance clause.** Every transaction carries a `weight_tolerance_pct`
  (default 5%). On delivery, the buyer records the actual weight. Within tolerance → settle at
  the agreed price. Outside tolerance → the price **auto-recalculates pro rata on a per-kg
  basis** and the seller must accept or dispute within 24h. This single rule eliminates the
  majority of disputes before they start.
- Carcass grading (BMC-style: age via dentition, conformation, fat class) is a structured
  field, not free text, so butchers can filter on it.

### 3.5 Connectivity and device reality
Rural Botswana: intermittent 2G/3G, expensive data, mid-range Android, shared devices.

- **DECISION: PWA, offline-first, not a native app.** Installable, works from cache, queues
  writes when offline and syncs on reconnect. One codebase, no app-store friction, instant
  updates. Revisit native only if push-notification reliability proves inadequate.
- Hard performance budget: **< 500 KB initial JS**, usable on 2G, images aggressively
  compressed and served in WebP/AVIF at multiple sizes.
- **SMS is a first-class channel, not a fallback.** Alerts, offer notifications, and escrow
  codes go by SMS. A farmer must be able to complete a sale knowing only that SMS works.
- **USSD companion** (Phase 3) for feature-phone users: list an animal, check offers, accept.

### 3.6 Language and literacy
- **Setswana and English from day one**, toggleable, with Setswana as the default when the
  device locale suggests it. Not a Phase-4 afterthought — it is an adoption prerequisite.
- Icon-led navigation. Numbers and photos over sentences. Voice notes permitted on listings.

### 3.7 Regulatory

- **Data Protection Act (Botswana, 2018)** — consent, purpose limitation, data subject access,
  breach notification. Build a consent ledger, not a checkbox.

- **RESOLVED — Escrow: the platform holds the trust account directly.** Not a PSP passthrough.
  This is a deliberate decision and it is defensible: it keeps the float, the settlement timing,
  and the dispute-hold logic under platform control rather than a third party's. It also makes
  the platform a custodian of other people's money, which changes what must be built.
  Requirements are specified in **§7.4–7.5** and are **not optional** — they are the difference
  between an escrow service and an unlicensed deposit-taking operation.

- **RESOLVED — Auctions require an auctioneer's licence.** Confirmed. Implications:
  - The timed-auction and any public ascending-price mechanic is **gated behind licence
    acquisition**. It does not ship until the licence is in hand. Phase 3 at the earliest.
  - **Design note worth checking with counsel before assuming the licence is needed at all
    for the core product:** what typically triggers auctioneer licensing is *conducting a
    public sale to the highest bidder*. The MVP's **best-offer** mechanic — private,
    seller-initiated counter-offers, no public bid visibility, seller free to accept any offer
    or none — is plausibly **not** an auction in the regulatory sense. The same may be true of
    **sealed-bid tender**. If counsel confirms, the platform reaches full commercial function
    without ever needing the licence, and auctions become an optional premium module rather
    than a blocker.
  - **DECISION:** Build best-offer and sealed-bid tender as the primary competitive mechanics.
    Treat public auctions as an add-on. Do not let a licensing process sit on the critical path
    to launch.
  - **Alternative distribution path:** partner with an **already-licensed auctioneer** (§2.7)
    who conducts auctions on the platform under their licence, taking a commission. Faster than
    obtaining a licence, and it brings their existing seller book with them.

- **OPEN:** Whether the trust account must be a segregated corporate account under a payment
  institution designation, or an **attorney's trust account** under the Legal Practitioners Act
  with a firm as stakeholder. The second option provides statutory ring-fencing and an
  established audit regime largely for free, at the cost of a per-transaction legal fee and
  slower release. Resolve before Phase 1 escrow goes live. See §14.

---

## 4. Listing model

### 4.1 What can be listed

| Category | Unit | Notes |
|---|---|---|
| **Cattle** | Head / lot | Flagship. Full individual animal records. |
| Small stock (goats, sheep) | Head / lot | Higher volume, lower value, often batch-listed |
| Poultry | Bird / crate / batch | Broilers, layers, day-olds |
| Pigs | Head / lot | |
| Breeding services | Service | Bull hire, AI straws, embryo |
| Feed & fodder | Bale / tonne / bag | Lucerne, hay, silage, licks, concentrates |
| Crops & produce | kg / tonne / bag | Sorghum, maize, beans, horticulture |
| By-products | Unit / kg | Hides, manure, bones |
| Equipment & inputs | Unit | Crushes, tanks, fencing, implements |
| Grazing & land lease | ha / month | Underused capacity |

**DECISION:** Build cattle end-to-end first and make the schema polymorphic
(`listing` + `listing_attributes` JSONB, validated per category). Do not build ten shallow
verticals — build one deep one, then widen. Cattle carry the value, the trust problem, and the
compliance complexity; everything else is easier afterwards.

### 4.2 The cattle animal record

Individual record (required for cattle sold as individuals or in lots ≤ 20):

```
lits_id            required, unique, format-validated
brand_mark         photo
breed              Tswana | Brahman | Simmental | Bonsmara | Composite | Other
sex                Bull | Cow | Ox/Tolly | Heifer | Weaner-M | Weaner-F | Calf
date_of_birth      or estimated_age_months
dentition          0 | 2 | 4 | 6 | 8 teeth   ← the field butchers actually filter on
weight_kg          + weight_method + weighed_at
body_condition     1–5 scale, with reference photos in the UI
horn_status        Horned | Polled | Dehorned
pregnancy_status   Open | Pregnant (months) | Lactating | N/A   ← required for females
vaccinations       [{vaccine, date, batch, administered_by}]
last_dip_date
sire_id / dam_id   optional, LITS IDs — enables pedigree, huge for stud sales
temperament        Docile | Average | Wild        ← genuinely matters to buyers
photos             min 3: side profile, rear, head/ear-tag close-up
video              optional, ≤ 30s, strongly encouraged — walking gait reveals soundness
```

For large lots, allow a **batch record** (count, weight range, age range, sex mix, sample
photos) plus a downloadable LITS ID manifest.

### 4.3 Listing fields

```
seller_id, farm_id, zone_id, location (PostGIS point, snapped to ~5 km for privacy)
title, description, voice_note_url
category, animals[] | batch_spec
sale_mechanism          (see §5)
price_basis             PER_HEAD | PER_KG_LIVE | PER_KG_CARCASS | PER_LOT
asking_price, currency (BWP), price_negotiable
lot_splittable          bool
min_purchase_qty        int
available_from, available_until
collection_terms        BUYER_COLLECTS | SELLER_DELIVERS | NEGOTIABLE
transport_assistance    bool
payment_methods_accepted[]
inspection_welcome      bool + viewing window
status                  (see §7 state machine)
verification_level      (see §8)
```

### 4.4 Reverse listings — "Want to Buy"

**Critical for butchers and the single feature most likely to make them pay.** A WTB is a
first-class object, not a forum post:

```
buyer_id, category, spec (same shape as a listing's filters)
quantity_needed, recurrence   ONE_OFF | WEEKLY | MONTHLY | QUARTERLY
budget_range, price_basis
delivery_location, max_sourcing_radius_km
required_by_date
contract_term_months          for recurring — this becomes a forward supply agreement
```

Farmers browse WTBs and **respond with an offer of specific animals**. The matching engine
runs in both directions: new listing → notify matching WTB owners; new WTB → notify farmers
holding matching stock.

---

## 5. Sale mechanisms

Support all five. The mechanism is chosen per listing and drives the UI and state machine.

| Mechanism | Flow | Best for |
|---|---|---|
| **Fixed price** | Buyer commits at asking price. First-come. | Small stock, produce, feed |
| **Best offer** | Buyers submit offers; seller accepts/counters/declines. Structured counter-offers, full thread history. | Default for cattle |
| **Timed auction** 🔒 | Opens/closes at set times. Reserve price. **Anti-sniping: any bid in the final 2 min extends the close by 2 min.** Proxy bidding (max bid, auto-increment). | Stud stock, competitive lots |
| **Sealed-bid tender** | Bids hidden until close; seller picks freely — no obligation to take the highest. | Large lots, institutional buyers |
| **Group buy / syndicate** | See §6. | Split lots, high-value shared assets |

🔒 **Licence-gated.** Auctioneer licensing is confirmed as required (§3.7). Timed auctions do
not ship until a licence is held, or until an already-licensed auctioneer partner conducts them
on-platform under their licence.

**DECISION:** Ship **fixed price + best offer** in the MVP; add **sealed-bid tender** in
Phase 2. These three carry the commercial load without touching the licensing question. Build
them so well that auctions become a nice-to-have rather than a dependency:

- Best-offer with **structured counter-offers**, full thread history, and offer expiry gives a
  farmer most of the price discovery an auction would, without the regulatory surface.
- Sealed-bid tender covers the competitive-tension case for large lots. Keep the seller's
  discretion explicit and unconstrained — *seller may accept any bid or none* — both because
  it is commercially correct for livestock (a buyer's reliability matters as much as their
  price) and because binding-to-highest-bidder is what makes a process look like an auction.

**Design constraint on all non-auction mechanics:** do not display live competing bid amounts
publicly, and do not auto-award to the highest bidder. Those two properties are what
distinguish these mechanics from an auction. Have counsel confirm the boundary before launch,
then hold the line on it in the UI.

---

## 6. The buy-in mechanic (the differentiator) — full specification

The original ask: *"other farmers get notified and can opt to buy in."* That resolves into two
genuinely different mechanics. Build both; they share machinery.

### 6.1 Mode A — Lot Splitting (higher volume, simpler)

Seller lists 40 head, flags it splittable with `min_purchase_qty = 5`. Multiple buyers claim
sub-quantities until the lot fills.

- Live progress bar: `28 of 40 claimed — 12 remaining`.
- Each claim is an independent transaction: its own escrow, its own permit, its own collection
  slot. One buyer defaulting does not affect the others.
- Seller sets `all_or_nothing`: if true, no claim settles until the lot is 100% claimed by the
  deadline; unfilled → all claims released. If false, claims settle as they are made.
- **Allocation:** buyers may claim *specific animals* by LITS ID (default for lots ≤ 20) or a
  *quantity* from a pool, with the seller allocating specific animals before collection. If the
  seller allocates, the buyer gets a **48h review window** to reject the allocation and withdraw
  penalty-free — otherwise sellers dump their worst animals on group buyers and the mechanic
  dies within a season.

### 6.2 Mode B — Syndicate Purchase (higher value, more novel)

Several buyers pool funds to acquire something none can afford alone: a stud bull, a full
truckload for freight economics, a feedlot pen.

```
syndicate {
  target_listing_id
  initiator_id
  total_value
  min_participants, max_participants
  funding_deadline
  share_model         EQUAL | BY_CONTRIBUTION | CUSTOM
  ownership_outcome   DIVIDED_PHYSICAL   — animals split at collection
                    | CO_OWNED_SHARED    — e.g. a shared bull, rotating custody
                    | RESALE_VENTURE     — buy to fatten and resell, split proceeds
  custodian_id        required for CO_OWNED_SHARED
  agreement_doc_url   generated from a template, e-signed by all members
}
```

**For `CO_OWNED_SHARED`, generate a real co-ownership agreement.** A shared bull with no written
agreement is a lawsuit. The template must cover: custody rotation schedule, who pays for feed
and vet care, what happens if the animal dies (insured? loss shared pro rata?), buy-out terms,
and exit on member default. E-signed by every member before funds release. **This is a feature,
not paperwork** — it is precisely what makes syndicates possible between people who are not
family.

### 6.3 Shared state machine

```
DRAFT → OPEN → THRESHOLD_MET → LOCKED → FUNDED → ALLOCATED → SETTLED → CLOSED
                    ↓                      ↓
                 LAPSED ←──────────────  FAILED  (refund all, notify all)
```

| State | Entry | Behaviour |
|---|---|---|
| `OPEN` | Published | Accepting pledges. Pledges are **soft** — withdrawable, no funds moved. |
| `THRESHOLD_MET` | min_participants **and** min_value reached | Notify all. Still open to more, up to max. |
| `LOCKED` | Deadline hit while threshold met, or initiator locks early | **Pledges become binding.** Funding window opens (default 72h). |
| `FUNDED` | All members' escrow deposits cleared | Seller notified to prepare. Permits initiated. |
| `ALLOCATED` | Specific animals assigned to members | 48h member review window per §6.1. |
| `SETTLED` | Collection confirmed, escrow released | Ratings prompted. |
| `LAPSED` | Deadline hit, threshold not met | All pledges void, no penalty, everyone notified. |
| `FAILED` | ≥1 member defaults during funding | See fallback ladder below. |

**Partial-funding fallback ladder** — the hardest case, and where a naive build breaks. When a
member defaults at `LOCKED`:

1. **Backfill:** notify the waitlist (users who pledged after `max_participants` was hit). 24h.
2. **Absorb:** offer remaining members the chance to increase their share pro rata. 24h.
3. **Renegotiate:** if the shortfall is < 20%, offer the seller a reduced quantity or price.
4. **Dissolve:** refund everyone, penalise the defaulter (§6.4), notify the seller.

Each step is time-boxed and auto-advances. Never leave a syndicate hanging.

### 6.4 Anti-abuse

- Pledges above a threshold require a **verified payment method on file** before the pledge is
  accepted — not at funding time.
- **Defaulting at `LOCKED` costs a deposit** (default 5% of the pledge), paid to the seller as
  compensation for the held stock, and a strike on the profile. Three strikes → syndicate
  participation suspended.
- Initiator reputation is displayed on every syndicate: `Led 7 syndicates · 7 completed`.
- Cap the number of concurrent open pledges per user by verification level.

---

## 7. Transaction lifecycle

### 7.1 Listing states

```
DRAFT → PENDING_REVIEW → ACTIVE ⇄ PAUSED
                            ↓
                    PARTIALLY_COMMITTED → FULLY_COMMITTED → CLOSED
                            ↓                    ↓
                        EXPIRED              (per-transaction flow below)
                         CANCELLED / SUSPENDED (admin or zone block)
```

### 7.2 Transaction states

```
OFFER_MADE → OFFER_ACCEPTED → ESCROW_PENDING → ESCROW_FUNDED
   ↓ declined      ↓ withdrawn        ↓ timeout
   ↓               ↓                  ↓
 CLOSED          CLOSED           CANCELLED

ESCROW_FUNDED → PERMIT_PENDING → READY_FOR_COLLECTION → IN_TRANSIT
              → DELIVERED → INSPECTION_WINDOW → SETTLED → CLOSED
                                   ↓
                              DISPUTED → RESOLVED → SETTLED | REVERSED
```

Every state carries a **timeout with an automatic action** — no transaction sits indefinitely:

| State | Default timeout | Auto-action |
|---|---|---|
| `OFFER_MADE` | 48h | Expire, notify both |
| `ESCROW_PENDING` | 72h | Cancel, release listing, strike buyer |
| `PERMIT_PENDING` | 14d | Escalate to admin, offer both parties a penalty-free exit |
| `READY_FOR_COLLECTION` | 7d | Escalate; seller may charge agreed holding/feed costs |
| `INSPECTION_WINDOW` | 24h | **Auto-settle** (release escrow to seller) |

**DECISION:** The inspection window auto-settles rather than auto-refunding. Silence favours
the seller who has performed. Otherwise a buyer can strand a seller's funds by doing nothing.

### 7.3 Collection handshake

At the loading ramp, both parties need certainty. The flow:

1. Buyer arrives. Opens the transaction in the app.
2. Buyer records **actual weight** (weighbridge ticket photo) and confirms LITS IDs — the app
   scans/keys each tag and **flags any animal not on the manifest**.
3. Price auto-recalculates if weight is outside tolerance (§3.4).
4. Seller reads a **6-digit collection code** from their app; buyer enters it. This is the
   mutual-consent moment.
5. Escrow releases per the payment schedule (§9.2). Both parties get an SMS receipt.
6. A signed **digital delivery note** is generated — useful at police roadblocks, which do stop
   livestock trucks and ask for proof of ownership.

**The whole handshake must work offline** and sync later. Loading ramps are not where signal is
good.

### 7.4 Escrow — platform-held trust account

Per §3.7, the platform holds client funds directly. This is the highest-consequence subsystem
in the product: **a bug here loses a farmer's cattle money, not a page view.** Build it with
that weighting.

**Account structure**

```
TRUST ACCOUNT (client funds — never platform money)
  ├── buyer deposits awaiting settlement
  ├── syndicate pledges held to funding deadline
  ├── funds held pending dispute resolution
  └── seller proceeds awaiting payout
OPERATING ACCOUNT (platform money — fees, salaries, everything else)
```

**Non-negotiable rules, enforced in code and in banking:**

1. **Segregation.** Client funds sit in a distinct bank account, never commingled with
   operating funds. Not "a separate ledger in the same account" — a separate account.
2. **The float is not revenue and is not spendable.** Money in the trust account belongs to
   users until settlement releases it. It does not fund payroll, it is not invested, it is not
   a working-capital line. Interest treatment must be defined in the T&Cs up front (either it
   accrues to users, or the platform's entitlement is disclosed — pick one and write it down).
3. **Fees are swept, not deducted in place.** On settlement, the fee moves trust → operating as
   an explicit, logged transfer with its own ledger pair. Never net a fee off a balance
   silently.
4. **The ledger must reconcile to the bank, daily and automatically.**
   `SUM(trust ledger balances) == bank statement balance`, every day, no exceptions. Any
   variance raises a **P1 alert** and freezes payouts until cleared. This job is as important
   as anything user-facing.
5. **Dual authorisation on payouts** above a configurable threshold (start at BWP 20,000). Two
   distinct admin accounts, logged. Single-admin release above threshold must be impossible,
   not merely discouraged.
6. **Ring-fencing in the T&Cs.** Terms must state explicitly that the platform holds funds as
   **stakeholder, not as principal**, that client funds are not platform assets, and that they
   are not available to platform creditors. Have counsel draft this — it is the clause that
   protects users if the company fails, and the clause a regulator will read first.
7. **Fidelity cover / professional indemnity insurance** sized to the peak float. Budget it as
   a fixed cost of doing business, not an optional extra.
8. **Independent annual audit** of the trust account. Publish that it happens; it is a
   marketing asset as much as a compliance one.

**Payment rails in.** Orange Money, MyZaka, bank EFT. Each has a different settlement lag —
mobile money is near-instant, EFT is not. **Model deposits as `PENDING` until bank-confirmed,
never on payment-initiation.** A transaction must not advance to `ESCROW_FUNDED` on an
optimistic assumption; that is the exact hole a fraudster walks through.

**Payout runs.** Batch seller payouts on a fixed schedule (e.g. twice daily) rather than
per-transaction, to reduce transfer fees and give a reconciliation checkpoint. Publish the
schedule so sellers know when to expect money — *"paid out within 4 hours of collection"* is a
selling point.

### 7.5 Escrow state and the money it maps to

Every escrow movement is a **paired ledger entry** (§10.3). No exceptions, no shortcuts.

| Event | Ledger movement |
|---|---|
| Buyer deposits | `DR bank:trust` / `CR user:buyer:escrow_held` |
| Escrow confirmed funded | `DR user:buyer:escrow_held` / `CR txn:{id}:held` |
| Settlement — seller portion | `DR txn:{id}:held` / `CR user:seller:payable` |
| Settlement — platform fee | `DR txn:{id}:held` / `CR platform:fee_receivable` |
| Fee sweep to operating | `DR platform:fee_receivable` / `CR bank:operating` (+ matching trust debit) |
| Seller payout executed | `DR user:seller:payable` / `CR bank:trust` |
| Refund (cancelled) | `DR txn:{id}:held` / `CR user:buyer:refundable` → payout |
| Partial refund (weight adj.) | Split settlement per §3.4 — two paired entries, both logged |
| Dispute hold | `DR txn:{id}:held` / `CR txn:{id}:disputed` — funds frozen, neither party paid |
| Syndicate pledge funded | `DR bank:trust` / `CR syndicate:{id}:member:{uid}` |
| Syndicate lapses | Reverse every member entry individually, refund each |
| Default deposit forfeited | `DR syndicate:{id}:member:{uid}` / `CR user:seller:payable` |

**Operational load — budget for it.** Holding funds is not only an engineering task. It needs a
named person doing daily reconciliation, a dispute officer with authority to release held
funds, a documented payout approval process, and a written procedure for what happens when the
bank and the ledger disagree. **Staff this before the first pula lands, not after.**

**Insolvency plan.** Write down, before launch, what happens to in-flight escrow if the
platform ceases operating: who releases the funds, on what authority, and to whom. A regulator
will ask. So will the first serious investor.

---

## 8. Trust, verification, and reputation

### 8.1 Verification tiers

Progressive, with real capability unlocks. Nobody completes a 12-step onboarding to browse.

| Tier | Requires | Unlocks |
|---|---|---|
| **T0 Unverified** | Phone + OTP | Browse, save searches, receive alerts |
| **T1 Identified** | National ID (Omang) + selfie match | Make offers up to BWP 20,000 |
| **T2 Verified Farmer** | Farm registration / lease + brand mark + address | Create listings, unlimited offers |
| **T3 Trusted Trader** | 5 settled transactions, ≥4.5 rating, zero unresolved disputes | Reduced fees, "Trusted" badge, priority in match ranking, higher syndicate caps |
| **T-B Verified Butcher** | Abattoir/butchery licence + business registration | Post WTBs, forward contracts, bulk tools |
| **T-T Verified Transporter** | Vehicle registration, licence, livestock-transport permit, insurance | Bid on transport jobs |

Badges are displayed on every listing. **Verification level is a ranking input** in search and
match, which makes verification self-reinforcing.

### 8.2 Reputation

- Two-sided ratings after settlement, **released simultaneously after both submit or 14 days
  pass** (blind, to prevent retaliatory rating).
- Rate on specific axes, not one star: *Accuracy of description*, *Communication*,
  *Punctuality*, *Animal condition as described*. Aggregate for display, but the axes are what
  a buyer actually wants to read.
- Surface hard behavioural counts, not just averages: `Completed 23 · Disputes 1 · Cancelled 2`.
- **Weight-accuracy score** for sellers, computed automatically from declared vs. actual
  weights across settled transactions. This is an objective, un-gameable trust signal and it is
  unique to this domain. Display prominently: `Weight accuracy: 98% (23 sales)`.

### 8.3 Fraud detection

Automated flags for admin review:
- Same LITS ID listed by different sellers → **hard freeze both**
- LITS ID on the stolen register → **block, notify reporter**
- New account, high-value listing, price far below the regional index → hold for review
- Photos failing a reverse-image check, or EXIF inconsistent with the claimed location
- Repeated off-platform contact attempts in messaging (regex + classifier on phone numbers,
  "call me", "WhatsApp me") — the leading revenue leak in every marketplace
- Velocity: many listings created and cancelled in a short window
- Buyer with a pattern of disputes filed against different sellers

---

## 9. The notification engine

**This is the beating heart of the product** — the original ask was "other farmers get
notified". Get this wrong and the platform is a dead classifieds board; get it right and it is
a habit.

### 9.1 Alert profiles

A saved search that pushes rather than pulls. A user can hold several (`"Weaners near
Palapye"`, `"Any Brahman bull under 25k"`).

```
alert_profile {
  categories[], breeds[], sex[], age_range, weight_range
  price_max, price_basis
  center_point, radius_km          — PostGIS, real distance not admin district
  zones_allowed[]                  — auto-derived from movement feasibility
  min_seller_tier, min_seller_rating
  keywords[]
  channels[]                       PUSH | SMS | WHATSAPP | EMAIL | IN_APP
  urgency                          INSTANT | HOURLY_DIGEST | DAILY_DIGEST
  quiet_hours                      default 21:00–06:00, respected by all channels except
                                   time-critical transaction events
  active_from / active_until       seasonal buying
}
```

### 9.2 Matching pipeline

```
listing.published
  → normalise & geocode
  → candidate profiles via PostGIS radius + category index
  → score each match (see below)
  → filter: score ≥ threshold; zone-movement feasible; not the seller; not blocked
  → dedupe against recent sends to that user (7-day window, same listing)
  → rate limit: max 5 instant alerts/user/day; overflow rolls into the digest
  → route by channel & urgency, honouring quiet hours
  → enqueue → send → record delivery, open, click, and outcome
```

**Match score** (0–1): weighted sum of spec fit, distance decay, price vs. the user's stated
maximum, seller tier, and — after enough data — a behavioural component learned from what the
user actually clicks and buys, not just what they declared. Log every send with its score and
the eventual outcome so the weights can be tuned against real conversion.

### 9.3 Alert types beyond new listings

Retention comes from the alerts users don't have to configure:
- **Price drop** on a watched listing
- **Outbid** on an auction; **closing soon** on a watched auction
- **Syndicate**: threshold met, funding window opening, deadline in 24h, member defaulted
- **WTB match**: "A butcher near you wants 15 head of what you're running"
- **Market intelligence** (weekly digest): *"Weaner prices in Central District are up 8% this
  month"* — no transaction required, pure value, drives habit
- **Compliance**: zone restriction affecting your listing or your open transaction
- **Seasonal nudges**: vaccination windows, auction calendar, weather-driven destocking alerts
- **Follow a seller** → alert on their new listings. Cheap to build, disproportionately sticky.

### 9.4 Channel strategy

| Channel | Use for | Cost |
|---|---|---|
| **Web Push** | Primary — instant matches, all transaction events | Free |
| **SMS** | Time-critical only: offer received, escrow funded, collection code, syndicate deadline | Metered — budget for it |
| **WhatsApp Business** | Rich listing cards with photos; the region already lives here | Per-conversation |
| **Email** | Digests, receipts, statements | Negligible |
| **In-app** | Everything, always. The durable record. | Free |
| **USSD** | Phase 3 — feature-phone list/check/accept | Per-session |

**DECISION:** SMS is metered and will be a real line item — gate instant SMS behind the T1
tier and cap per-user daily volume. Push and in-app carry the load; SMS carries the moments
where money or animals are moving.

---

## 10. Architecture and stack

### 10.1 Recommended stack

**DECISION:** Chosen for a small team, low ops burden, and strong offline/geo support.

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + TypeScript + React** | SSR for SEO on listings — organic search is a real acquisition channel; one framework for web + PWA |
| Styling | **Tailwind + shadcn/ui** | Fast, consistent, small |
| PWA | **Workbox + IndexedDB** | Offline listing drafts, cached browse, queued writes |
| API | **tRPC** (internal) + **REST** (public/partner) | Type-safe internally; REST for feedlots and future integrations |
| DB | **PostgreSQL 16 + PostGIS** | Radius matching is core; PostGIS is non-negotiable |
| ORM | **Prisma** | Migrations, type generation |
| Cache/queue | **Redis + BullMQ** | Match jobs, notification fan-out, timeout scheduling |
| Search | **Postgres FTS** → **Typesense** at scale | Don't reach for Elasticsearch on day one |
| Files | **S3-compatible + CDN**, on-the-fly image resize | Photos are the bulk of the payload |
| Auth | **Phone-first OTP** (Auth.js) | Email is not the primary identity here |
| SMS/USSD/WhatsApp | **Africa's Talking** (regional coverage, USSD support) with Twilio fallback | |
| Payments | **Orange Money + MyZaka/Mascom + bank EFT**, collecting into a **platform-held trust account** (§7.4) | Mobile money is how the market actually pays. Aggregators reduce integration count but **must not** hold the float — collection only, settling into the trust account |
| Ledger | **Postgres, in the primary DB, double-entry** — not a separate service | Money and transaction state must commit in the same DB transaction. Splitting them across services creates reconciliation gaps that are extremely painful to close later |
| Notifications | Custom orchestrator over Redis + FCM Web Push | Business logic is too domain-specific to outsource |
| Hosting | **Vercel** (web) + **managed Postgres** + **Railway/Fly** (workers) | Region: choose the lowest-latency to Southern Africa; measure, don't assume |
| Observability | **Sentry + PostHog + structured logs** | PostHog for funnels; you will need them |

**Alternative if the team is very small:** Supabase (Postgres + PostGIS + auth + storage +
realtime) collapses four services into one and is a legitimate accelerant. Trade-off is less
control over the notification pipeline, which is the one thing worth controlling.

### 10.2 Services

```
web (Next.js)  ──┬── api (tRPC/REST)
                 ├── match-worker         listing/WTB → alert profile matching
                 ├── notify-worker        channel fan-out, retries, delivery tracking
                 ├── escrow-worker        PSP webhooks, state transitions, reconciliation
                 ├── timeout-scheduler    every state timeout in §7.2
                 ├── index-worker         nightly price index computation
                 └── media-worker         image/video processing, EXIF, reverse-image check
```

### 10.3 Core data model (abbreviated)

```
users, farms, zones, verifications, consents
listings, listing_media, animals, animal_health_events, batch_specs
want_to_buys, alert_profiles, alert_sends, follows, watchlists
offers, offer_messages, transactions, transaction_events
syndicates, syndicate_members, syndicate_pledges, syndicate_agreements
escrow_accounts, payments, payouts, refunds, fees, ledger_entries
permits, permit_documents, zone_restrictions
transport_jobs, transport_bids, deliveries, delivery_notes
ratings, disputes, dispute_messages, dispute_resolutions
price_observations, price_index_snapshots
stolen_stock_reports, fraud_flags, audit_log
```

**DECISION: double-entry ledger for all money movement.** `ledger_entries` with paired
debit/credit rows, never a mutable `balance` column. Escrow, split syndicate payments, partial
refunds, fees, and transport payouts will otherwise become unreconcilable within months.

**DECISION: append-only `transaction_events` and `audit_log`.** Livestock disputes go to real
arbitration and sometimes to court. An immutable event log is the evidence.

### 10.4 Key API surface

```
POST   /listings                        create (draft-capable, offline-syncable)
GET    /listings?filters&near=lat,lng&radius_km=  search
POST   /listings/:id/offers             make an offer
POST   /offers/:id/{accept,counter,decline}
POST   /listings/:id/claim              lot-split claim
POST   /syndicates                      open a syndicate
POST   /syndicates/:id/pledge           soft pledge
POST   /syndicates/:id/fund             binding funding
POST   /transactions/:id/escrow/fund
POST   /transactions/:id/permit         attach movement permit
POST   /transactions/:id/collect        collection handshake (code + weight + LITS scan)
POST   /transactions/:id/dispute
GET    /price-index?category&region&period
POST   /alert-profiles
POST   /want-to-buys
POST   /transport-jobs/:id/bids
POST   /stolen-stock/report
```

### 10.5 The price index (defensible moat)

Compute from **settled transactions only** — not asking prices, which are aspirational.

- Aggregate by category × breed × sex × weight band × region × month.
- Publish median, P25, P75, volume, and month-on-month change.
- **Suppress any cell with fewer than 5 transactions** from distinct sellers — both for
  statistical honesty and to protect commercial confidentiality.
- Surface it three ways: a public page (SEO and press), a widget on the listing composer
  (*"Similar animals sold for BWP 8,200–9,500 last month"*), and the weekly digest.

**This becomes the reference price for the region.** It is the hardest thing for a competitor
to replicate, it takes transaction volume to build, and it is what makes the platform matter
beyond its own users.

---

## 11. Monetisation

**DECISION: free to list, always.** Supply liquidity is the whole game; taxing listings kills
it. Charge where value is realised.

| Stream | Model | Notes |
|---|---|---|
| **Success fee** | 1.5–3% of settled value, seller-side | Primary. Only charged on completion. Tapers with tier: T3 pays less. |
| **Escrow fee** | Flat BWP 50–150, or bundled into the success fee | Now covers real internal cost: collection fees, reconciliation staff, fidelity cover, audit. Since the platform holds the account (§7.4), this is a genuine cost centre — price it deliberately rather than treating it as a passthrough |
| **Butcher/feedlot subscription** | Monthly — WTBs, forward contracts, bulk tools, API, priority alerts | Highest willingness to pay |
| **Featured listings** | Boosted ranking, badge | Self-serve, low friction |
| **Transport commission** | 5–10% of the freight job | |
| **Verification services** | Third-party inspection/valuation, at a fee | Partner-delivered |
| **Data & insights** | Aggregate market reports to banks, insurers, government, agri-processors | Later, high margin, **anonymised only** |
| **Financing referrals** | Refer buyers to livestock finance/insurance partners | Later |

**Launch pricing:** waive the success fee entirely for the first 6 months in the pilot region.
Liquidity first; monetisation is a Phase-3 problem. A marketplace with no listings has nothing
to take a percentage of.

---

## 12. Roadmap

### Phase 1 — MVP (12–14 weeks). *Goal: prove farmers will list and buyers will come.*
- Phone-OTP auth, T0–T2 verification
- Cattle listings with full animal records, LITS ID required, photo upload
- Search + filter + map, PostGIS radius
- **Alert profiles + push/SMS notifications** — do not defer this; it is the product
- Best-offer and fixed-price flows, in-app messaging
- **Escrow: manually released, but fully ledgered from day one.** The release decision is a
  human clicking a button in admin; the *accounting* is not manual. Every movement writes
  paired ledger entries (§7.5), and daily bank reconciliation runs from the first deposit.
  Automating release can wait until volume justifies it — **correct books cannot.** Retrofitting
  a double-entry ledger onto months of ad-hoc transfers is a project nobody survives cheerfully.
- Trust account operational readiness: segregated account open, dual-authorisation payouts,
  reconciliation job + P1 alerting, T&Cs with the stakeholder/ring-fencing clause, fidelity
  cover bound, named person responsible for daily reconciliation
- Two-sided ratings
- Setswana + English
- PWA, offline browse and draft listings
- Admin: verification queue, listing review, dispute inbox

### Phase 2 — The differentiator (8–10 weeks). *Goal: prove the buy-in mechanic works.*
- **Lot splitting**
- **Syndicate purchases**, both ownership models, generated co-ownership agreements
- Automated escrow release (rules-driven, on the collection handshake) with manual override
  retained for disputes and anything above the dual-authorisation threshold
- **Sealed-bid tender** — competitive tension without the auctioneer licence
- Want-to-Buy listings + reverse matching
- Movement-permit workflow, zone restriction enforcement
- Weight-tolerance auto-adjustment, collection handshake
- Transporter role and job board
- Price index v1

### Phase 3 — Depth (10–12 weeks)
- **Timed auctions — hard-gated on the auctioneer's licence being in hand**, or on a licensed
  auctioneer partner going live. Start the licence application in parallel with Phase 1 so it
  is not the thing holding Phase 3; it is paperwork with a lead time, not engineering, and it
  can run in the background at near-zero cost to the build.
- Forward supply contracts for butchers
- USSD companion
- WhatsApp integration
- Other categories: small stock, feed, produce
- Public price index + weekly market report
- Partner API for feedlots and abattoirs

### Phase 4 — Ecosystem
- Financing and insurance partners
- Herd-management tooling (the natural land-grab: own the record, own the sale)
- Cross-border SADC trade
- DVS/LITS direct integration

---

## 13. The condensed build prompt

*Paste this into a coding agent to begin. It assumes the sections above are available as
context.*

> Build **Kraal**, a livestock marketplace for Botswana connecting farmers to each other and
> to butchers, per the specification in `MASTER_PROMPT.md`.
>
> **Stack:** Next.js 15 (App Router, TypeScript), Tailwind + shadcn/ui, PostgreSQL 16 +
> PostGIS via Prisma, Redis + BullMQ workers, S3-compatible storage. PWA with offline support.
>
> **Build Phase 1 only.** In order:
>
> 1. **Schema & migrations** — implement the data model in §10.3. Enforce: LITS ID unique and
>    required on cattle; PostGIS point on farms and listings; append-only `transaction_events`
>    and `audit_log`; double-entry `ledger_entries`.
> 2. **Auth** — phone-first OTP, tiered verification (§8.1) as middleware-enforced capability
>    gates, not UI-only checks.
> 3. **Listings** — creation flow optimised for a farmer on a phone at a kraal: camera-first,
>    ≤ 3 minutes, autosaves offline to IndexedDB, syncs on reconnect. Full cattle animal record
>    per §4.2. Multi-photo upload with client-side compression.
> 4. **Search** — filters, PostGIS radius, map + list views. **Zone-aware:** never surface a
>    listing the buyer cannot legally move (§3.2). Show the movement-feasibility banner.
> 5. **Notification engine** (§9) — alert profiles, BullMQ match worker, scored matching,
>    dedupe, rate limits, quiet hours, push + SMS via Africa's Talking. Log every send with its
>    score and outcome.
> 6. **Offers & transactions** — best-offer threads with structured counter-offers; the state
>    machine in §7.2 with every timeout implemented as a scheduled job.
> 7. **Escrow & ledger (§7.4–7.5)** — the platform holds the trust account, so this is core,
>    not an integration. Build: double-entry ledger with paired entries for every movement;
>    deposits `PENDING` until bank-confirmed; admin-triggered release with dual authorisation
>    above BWP 20,000; daily reconciliation job asserting ledger total == bank balance, with a
>    P1 alert and automatic payout freeze on any variance; batched payout runs. **Money and
>    transaction state must commit in the same DB transaction.**
> 8. **Ratings & disputes** — blind two-sided ratings, automatic weight-accuracy score,
>    dispute state freezes the associated escrow funds.
> 9. **Admin** — verification queue, listing review, dispute inbox, zone-restriction toggle,
>    fraud-flag review, escrow release console with a full audit trail on every release.
> 10. **i18n** — Setswana and English, complete. No hardcoded strings anywhere.
>
> **Hard constraints:**
> - Every user-facing string is translatable. Setswana is a launch language, not a Phase-4 task.
> - < 500 KB initial JS. Test on throttled 2G.
> - Listing creation and browse must work offline.
> - Zone restrictions are hard blocks on the transaction state machine, never warnings.
> - No transaction state may sit indefinitely — every state has a timeout with an auto-action.
> - **All money movement goes through the double-entry ledger. Never mutate a balance column.
>   Never net a fee off a balance silently. Client funds and platform funds are separate
>   accounts, and the code must make commingling structurally impossible, not merely unlikely.**
> - **No public display of competing bid amounts, and no automatic award to the highest
>   bidder** — these properties are what keep the MVP's mechanics outside auctioneer licensing
>   (§3.7/§5). Do not add them without legal sign-off.
> - Escrow tests are not optional: cover partial refunds, weight-adjusted settlement,
>   double-submission of a release, and reconciliation drift. Property-test that the ledger
>   sums to zero after any sequence of operations.
>
> **Explicitly out of scope for Phase 1:** auctions (licence-gated), syndicates, lot splitting,
> sealed-bid tender, USSD, automated escrow release, categories other than cattle.
>
> Start by proposing the Prisma schema for review before writing application code.

---

## 14. Open questions to resolve before building

**Resolved:**
- ~~Escrow: PSP or self-held?~~ → **Platform holds the trust account.** See §3.7, §7.4–7.5.
- ~~Do auctions need a licence?~~ → **Yes.** Auctions are licence-gated to Phase 3; the MVP
  routes around the requirement via best-offer and sealed-bid tender. See §3.7, §5.

**Still open — the escrow decision opened three follow-ons, and they are now the highest
priority items on this list:**

1. **Trust account structure** *(blocks Phase 1 escrow going live)* — segregated corporate
   account under a payment-institution designation, or an **attorney's trust account** under
   the Legal Practitioners Act? The attorney route gives statutory ring-fencing and an
   established audit regime, at the cost of per-transaction legal fees and slower release. The
   corporate route is cheaper and faster but the ring-fencing must be constructed contractually
   and is weaker in an insolvency. **Get a written opinion — the answer determines both the
   banking setup and the release latency users experience.**
2. **Payment-institution licensing** *(blocks Phase 1 escrow going live)* — does holding
   client funds for livestock settlement require designation or authorisation under the
   **National Payment System Act**, and does NBFIRA have any interest? Confirm in writing
   before the first deposit, not after. If authorisation is required, the lead time goes on
   the critical path and Phase 1 may need to launch with introductions-only and no escrow.
3. **Interest on the float** — who is entitled to it, and what must the T&Cs disclose? Decide
   before writing terms; it is very hard to change afterwards.
4. **Auctioneer licence vs. partner** — apply directly (start now, runs in the background), or
   partner with a licensed auctioneer who brings their seller book? Not urgent, but starting
   the application early costs almost nothing and removes it from the Phase 3 critical path.
5. **Confirm the licensing boundary** — get counsel to confirm in writing that best-offer and
   sealed-bid tender, *as specified in §5*, do not constitute auctions. This single opinion
   determines whether the licence is a launch blocker or an optional upgrade. Ask it early;
   it is the cheapest high-leverage question on this list.
6. **LITS API access** — is programmatic verification obtainable from DVS, and on what terms?
   Determines whether §3.1 is a real control or a self-declared one.
7. **Pilot region** — a single district with real cattle density and reasonable connectivity.
   Central District (Serowe/Palapye) is the obvious candidate. Liquidity is local before it is
   national; launching countrywide with thin coverage everywhere is the classic marketplace
   death.
8. **Cold-start supply** — which 50 farmers list first, and who recruits them? Extension
   officers and farmers' associations are the realistic channel, not digital advertising.
9. **Butcher anchor** — signing 3–5 butchers to standing WTBs *before* launch gives the first
   farmers a reason to list. Demand-side anchoring beats supply-side incentives.

---

## 15. Success metrics

**Phase 1 — liquidity, not revenue**
- Listings created per week; % reaching an offer; % settled
- Median time-to-first-offer *(target: < 48h)*
- Alert → click → offer conversion *(the notification engine's report card)*
- Repeat listing rate at 60 days *(the honest signal that it works)*

**Phase 2 — the mechanic**
- Syndicates opened vs. reaching `SETTLED` *(target: > 60%)*
- % of lots sold split vs. whole
- Median lot fill time
- Dispute rate per 100 transactions *(target: < 3)*

**Ongoing**
- GMV; take rate; price-index coverage (cells with ≥ 5 transactions)
- Realised seller price vs. the regional index — **the platform's actual reason to exist. If
  farmers selling on Kraal do not measurably beat the farm-gate speculator price, nothing else
  in this document matters.**
