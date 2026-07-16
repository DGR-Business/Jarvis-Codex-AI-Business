# MOCK PACK — Batch 01 (first publish) · 2026-07-03
**STATUS: BOTH ITEMS APPROVED by operator 2026-07-04 — first Stage-1 approvals.
In production: print files → Gelato co-session → Etsy publish.**
Rail: Gelato (connected) → Etsy supplier-push. Copy sources: the April listing packs in
for-review/ (deltas below are the only changes).

---

## ITEM 1 — Night Shift Nurse Crewneck Sweatshirt
| | |
|---|---|
| Design | `outputs/nurse-nightshift-sweatshirt-v1.png` — **QC: PASS** (flawless text, clean editorial type, thumbnail-legible) |
| IP screen | **LOW** — no marks found on phrase; "fueled by coffee" format is generic/crowded (competition, not legal risk) |
| **Authenticity screen** | **VALIDATED.** Multiple independent Etsy sellers run this exact genre (night-shift/sleep-deprivation/dark-humor, same Gildan 18000 / Comfort Colors base) successfully — e.g. "Sounds Like A Day Shift Problem," "Night Shift Problems Sweatshirt," several "trendy RN gift" listings. Genuine positive reviews cite them as gifts for real night-shift workers ("very fun, nice quality shirt... bought for my son-in-law who works night shift"). "Monitors" is real insider detail (actual equipment nurses hear), not a generic outsider guess. **This is a proven, working format — not a fluke.** |
| Product | Gildan 18000 crewneck (confirmed in Gelato's Gildan collection) — Dark Heather Gray / Navy / Black, S–3XL |
| Price | **A$70.00** — est. profit ~A$20 (28%); confirm live Gelato base cost at creation |
| Copy | LISTING-PACK-nurse-humour-2026-04-24.md → Listing 1, unchanged (US English ✓, AI disclosure ✓) |
| Production note | **FINAL: Variant A chosen by operator 2026-07-04** — front-only minimal layout (ECG top-left chest + compact phrase top-right). **Production file: `nurse-nightshift-front-4500x5400-v3.png`** (4500×5400, 300 DPI, transparent). Superseded, kept for history: v1 mockup, v2 centered block, variant B front/back files. Single print side = full ~A$20 margin preserved at A$70. |

## ITEM 2 — Pilates Humor Mug (11oz)
| | |
|---|---|
| Design | `outputs/pilates-mug-design-v1.png` — **QC: PASS** (bold, clean, zero text errors) |
| IP screen | **LOW** — no registration on phrase; "Pilates" itself ruled generic (2000). Crowded meme format noted |
| **Authenticity screen** | **VALIDATED.** Multiple independent sellers run this "self-deprecating pilates devotee" register successfully (e.g. "Leave It All On The Reformer," "Pilates Be Strong / Reformer Pose"). Comps use real insider terminology ("reformer") correctly, not generic fitness-outsider language. Strongest signal: one buyer reported wearing a comparable shirt in public and receiving compliments — genuine real-world social acceptance, the opposite of a cringe reaction. **Format is validated**, though this exact phrase's reception (vs the genre generally) is untested — a normal first-listing bet, not a stereotype guess. |
| Product | White 11oz ceramic mug — Gelato base ~US$6–8, local AU/US production; confirm at creation |
| Price | **A$29.00** — est. margin ~45% after Etsy fees at ~A$10–12 COGS; reprice A$32 if base > US$9 |
| Copy | LISTING-PACK-pilates-mug-2026-04-24.md with **2 fixes** (below) |
| Production note | Flat design → size to Gelato's mug wrap template (~3300×1500px) or rebuild in Gelato's text tool |

**Pilates copy fixes (Printify-era lines → Gelato reality):**
1. Description line "Ships from a US-based print partner. Arrives ready to wrap..." →
   "Printed locally to the buyer — produced in the region it ships to, so it arrives fast
   and ready to hand over."
2. Bullet "• Ships from a US-based print partner — no international wait times for US buyers" →
   "• Printed locally to the buyer — fast delivery in the US, AU, UK and EU"

---

## Queued for Batch 02 (designs not yet generated)
- NICU Nurse Tee (Comfort Colors 1717 — confirm 1717 exists in Gelato catalog; fallback:
  closest garment-dyed heavyweight tee) — prompt ready in nurse pack
- Sarcastic Nurse Mug — prompt ready; price pending live COGS check

## On approval (per item)
1. Regenerate/size the print file → operator sanity-check
2. Create product in Gelato (operator logged in, Jarvis guides; or Claude-in-Chrome with
   operator sign-off) → set variants → generate mockups
3. Push to Etsy via Gelato → verify listing fields against the pack → PUBLISH
4. Log to external-actions.log + git commit + record listing URL in current-state.md

## Rejections
Log to config/taste-memory.md with reason → rule derived → design revised or family killed.
