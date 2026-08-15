---
name: pantheon-ui-visual-qa
description: Build or review Pantheon owner-facing UI with interactive visual inspection and selective automated browser regression.
---

# Pantheon UI Visual QA

- Reuse the design system and owner-facing language.
- Run the actual app and inspect the affected experience interactively through an approved browser.
- Exercise the user journey; inspect console and network state where relevant.
- Check desktop/laptop/responsive widths, accessibility, overflow, loading, empty, error, blocked and approval states.
- Critique hierarchy, spacing, density, animation, readability and trustworthiness; iterate before completion.
- Use Storybook for useful component states.
- Add or run Playwright only for stable critical flows, prior regressions, CI smoke, or justified cross-browser assertions.
- Do not infer visual quality from code or create brittle pixel tests solely to satisfy a checkbox.
