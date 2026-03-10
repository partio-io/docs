# CLAUDE.md — docs/

Mintlify documentation site for partio, deployed to https://docs.partio.io.

## Project overview

This repo contains the documentation for the [partio CLI](https://github.com/partio-io/cli). Partio captures AI agent sessions alongside Git commits, preserving the reasoning behind code changes.

## File structure

```
mint.json                  # Site config: navigation, tabs, colors, links
introduction.mdx           # Home page
quickstart.mdx             # Quick start guide
core-concepts.mdx          # Sessions, checkpoints, strategies, git worktrees
cli/
  installation.mdx         # Install instructions (Homebrew, Go, source)
  commands.mdx             # CLI command reference
  configuration.mdx        # Config files, env vars
  strategies.mdx           # Capture strategies
app/
  overview.mdx             # Dashboard overview (stats, heatmap, recent commits)
  repositories.mdx         # Repository browser (search, filter, list)
  repository-detail.mdx    # Per-repo tabs (Overview, Checkpoints, Commits, PRs, Code)
  checkpoint-detail.mdx    # Checkpoint deep dive (Sessions, Plan, Files)
  settings.mdx             # Theme customization (50+ OMARCHY themes)
  self-hosting.mdx         # Self-hosting guide (env vars, install, production)
integrations/
  claude-code.mdx          # Claude Code integration guide
images/
  app/                     # Auto-generated GIFs for app documentation
logo/                      # Logo SVGs for dark/light themes
favicon.svg                # Site favicon
```

## MDX frontmatter

Every `.mdx` page requires:

```yaml
---
title: Page Title
description: "Short description for SEO and navigation"
---
```

## Mintlify components used

- `<Tabs>` / `<Tab>` — tabbed content (install instructions, shell completions)
- `<Card>` / `<CardGroup>` — linked cards for navigation
- `<Warning>` — callout blocks
- Markdown tables for structured data

## Navigation

Configured in `mint.json`:

- **Tabs** define top-level sections (`CLI Reference`, `App`, `Integrations`)
- **navigation** arrays define page ordering within each tab/group
- Pages are referenced by their file path without extension (e.g., `cli/installation`)

## Adding a new page

1. Create a `.mdx` file with `title` and `description` frontmatter
2. Add the file path (without `.mdx`) to the appropriate `navigation` group in `mint.json`

## Local development

```bash
npm i -g mintlify
mintlify dev          # Start local preview at localhost:3000
```

## Related repos

| Repo | Description |
|------|-------------|
| [partio-io/cli](https://github.com/partio-io/cli) | The partio CLI (Go) |
| [partio-io/site](https://github.com/partio-io/site) | Marketing website (Next.js) |
