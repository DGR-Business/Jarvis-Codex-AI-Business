# Taste Memory

Codex handover note, 2026-07-06: old POD examples remain useful taste evidence,
but current sequencing is digital products first unless the master plan changes.
The operator's eye, encoded. Every design/mock rejection is logged here WITH the reason,
and a rule is derived. **Designers and the quality-checker MUST read this file before
generating or reviewing any design.** Rules compound — this file is how the system earns
Stage-2 autonomy.

Format:
`DATE | family | REJECTED/REVISED | operator reason | derived rule`

## Standing rules (seed set, 2026-07-03)
- Favor bold, simple, striking compositions; avoid cluttered/busy designs.
- Text on designs must be flawless — any malformed glyph is an automatic fail.
- No generic "AI look": waxy gradients, uncanny hands/faces, incoherent background detail.
- Low-subjectivity families first (aesthetic prints, minimalist typography, line art);
  taste-heavy niches only after Stage 2.

## Epistemic rule: whose judgment governs what (operator directive 2026-07-03)
The operator is frequently not a member of a niche's target demographic (not a nurse, not
a pilates-goer, etc.) and his gut reaction to the JOKE/GENRE is explicitly NOT authoritative
in that case — it's a personal bias, not signal. Split judgment by what it's actually
judging:
- **Genre/joke resonance with an audience the operator isn't in** → governed by the
  researcher's Phase 3.7 Authenticity Screen (comps + insider-language evidence), not by
  operator gut. VALIDATED genres proceed even if they read as unfamiliar or uncertain to
  the operator on first look.
- **Craft/execution quality** (clean vs cheap-looking, broken text, composition, "would I
  personally wear/use the physical object") → operator judgment is fully authoritative,
  always, at every stage.
So: an "I'm not sure this lands" reaction on a validated niche is a prompt to check the
evidence, not a rejection. An "this looks cheap/broken" reaction is always acted on.

## Design Registers (named style references)
Reusable, concrete style descriptions the researcher/designer brief against — an
alternative to vague "bold/simple" language.

**Modern Witty/Ironic Minimalism** (added 2026-07-03, reference: Uncle Reco's *simple*
lane, not their busier vintage/distressed lane — see below)
- Clean, minimal composition: one sharp one-liner or short exchange, generous white space,
  a single accent color or two max. NOT distressed/vintage-textured, NOT cluttered.
- Tone: dry, deadpan, contemporary meme-literate irony — self-aware, never mean-spirited,
  never trying visibly hard to be funny (the tryhard tell: over-explaining the joke,
  excess exclamation marks/emoji, generic "big mood" filler phrasing).
- Typography-led over illustration-led; when illustration is used, simple flat/line style.
- **Note on the reference brand:** Uncle Reco itself (unclereco.com) is broader than this —
  loud, nostalgic, vintage-textured, Australian-pop-culture-referencing. That busier lane
  is a DIFFERENT register; don't blend the two without a deliberate reason. Also: Etsy
  traffic is majority US (2026-04-02 decision) — keep phrasing broadly relatable, not
  Australian-slang-specific, unless a family is deliberately built for an AU-facing channel.
- **IP boundary:** reference brands calibrate taste only — see config/guardrails.md
  copyright rule. Every design in this register must be an original phrase/composition.
- **Status:** captured as a candidate family, not yet built. Under the Codex handover,
  digital-product pilots come first; this taste register can be reused when a product
  family or channel makes it commercially relevant. If validated with its own traction,
  this is the natural trigger for the operator's envisioned dedicated brand + Shopify
  store.

## Rejection log
2026-07-04 | nurse-humour sweatshirt v2 | REVISED | moon icon sat too close to the text
label | RULE: icons need breathing room — minimum clear space of ~0.5× icon height
between an icon and any text.

2026-07-04 | nurse-humour sweatshirt v2 | REVISED | large centered full-front text block
rejected as layout; operator wants apparel to read like real streetwear, not a billboard |
RULE: default apparel layout = small minimalist insignia at top-left chest (e.g. stylised
ECG line for nurse family) + phrase placed small on the opposite chest side, or subtle on
the upper back. Large centered text blocks only when a niche's comps prove that's the
winning format. Operator supplied reference mocks (small embroidered-style chest logos,
minimal ECG motif) — "if we're going to do this, let's do it right."

2026-07-04 | nurse-humour | NOTE | operator's own ChatGPT mock self-critique: big back
text "too jarring" | RULE: back prints, if used, sit smaller at upper back, never a
full-width slab. Also: front-only prints cost less at Gelato (second print side adds
base cost) — minimal single-side layouts are better for margin too.
