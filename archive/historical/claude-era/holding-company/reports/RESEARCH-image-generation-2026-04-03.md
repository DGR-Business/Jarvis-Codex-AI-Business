# Image Generation for Claude Code: Nano Banana, MCP Servers, and Alternatives
**Date:** 2026-04-03 | **Status:** For operator review

---

## Executive Summary

"Nano Banana" = community nickname for Google's Gemini image generation models. Multiple MCP servers exist. Best options for this system:

1. **Replicate MCP (official)** — FLUX models at $0.003-$0.025/image. Lowest friction.
2. **Nano Banana MCP** — Gemini image gen, ~500 free images/day, 4K native with Pro model.
3. **ComfyUI MCP (local)** — Free generation on RTX 3080 Ti. Best for volume. Phase 2.

---

## What Is "Nano Banana"?

Community nickname for Google's Gemini image generation model family:

| Nickname | Model ID | Cost (API) | Max Resolution |
|----------|----------|-----------|----------------|
| Nano Banana v1 | gemini-2.5-flash-image | $0.039/img | 2K |
| Nano Banana 2 | gemini-3.1-flash-image-preview | $0.045-$0.151/img | 4K |
| Nano Banana Pro | gemini-3-pro-image-preview | $0.134-$0.24/img | 4K native |

**Free tier:** ~500 requests/day via Google AI Studio. No credit card needed.

**POD suitability:** Pro at 4K = 13.7x13.7 inches at 300 DPI. Excellent for apparel and poster.

---

## Integration Options for Claude Code

### Option A: Nano Banana MCP Server (Recommended)

Add to `.mcp.json`:
```json
{
  "mcpServers": {
    "nanobanana": {
      "command": "npx",
      "args": ["-y", "@ycse/nanobanana-mcp"],
      "env": {
        "GOOGLE_AI_API_KEY": "${GOOGLE_AI_API_KEY}"
      }
    }
  }
}
```

**Requires:** Google AI Studio API key (free). No GPU needed.
**Features:** Text-to-image, image editing, style transfer, model switching.

### Option B: Replicate MCP (Official — Recommended)

```bash
claude mcp add "replicate" --scope user --transport stdio -- npx -y replicate-mcp@alpha --tools=code
```

**Models:** FLUX.1 Schnell ($0.003/img), FLUX.1 Dev ($0.025/img), FLUX.2 Dev ($0.012/MP)
**Requires:** Replicate API key. No GPU needed.
**Why:** Cheapest per-image, high quality FLUX models, official support.

### Option C: ComfyUI MCP (Local GPU)

Multiple implementations:
- **Peleke/comfyui-mcp** — Most feature-complete (txt2img, img2img, upscale, ControlNet)
- **artokun/comfyui-mcp** — Claude Code plugin included
- **nikolaibibo** — 15 MCP tools, FLUX/SD templates

**Setup:** Install ComfyUI → download FLUX model → start server → add MCP config
**Cost:** $0 ongoing (electricity only)
**RTX 3080 Ti:** FLUX.1 Schnell ~10-20 sec/image at 1024x1024

---

## Comparison Table

| Tool | Cost/Image | POD Quality | Setup | GPU Needed? |
|------|-----------|-------------|-------|-------------|
| Nano Banana MCP | $0.039-$0.24 (500 free/day) | HIGH (4K native) | LOW | No |
| Replicate MCP | $0.003-$0.025 | HIGH | LOW | No |
| ComfyUI MCP | $0 (electricity) | VERY HIGH | MED-HIGH | Yes |
| DALL-E MCP | $0.04-$0.12 | MEDIUM | LOW | No |
| Stability AI MCP | $0.01-$0.04 | MED-HIGH | LOW | No |

---

## Gemini CLI + Nano Banana Extension

Gemini CLI is a separate tool from Claude Code. It can be installed alongside:

```bash
npm install -g @google/gemini-cli
gemini extensions install https://github.com/gemini-cli-extensions/nanobanana
```

Claude Code can call Gemini CLI via Bash tool for image generation. But the MCP approach (Option A) is cleaner.

---

## Recommended Install Order

1. **Replicate MCP** — one command, cheapest, high quality FLUX models
2. **Nano Banana MCP** — 500 free/day, 4K native output, good for typography
3. **ComfyUI** — when generating 200+ designs/week (Phase 2)

---

## Sources
- github.com/YCSE/nanobanana-mcp
- github.com/kkoppenhaver/cc-nano-banana
- replicate.com/docs/reference/mcp
- github.com/Peleke/comfyui-mcp
- github.com/artokun/comfyui-mcp
- blog.google (Nano Banana 2, Nano Banana Pro announcements)
