# Partio Documentation

Documentation site for [partio](https://github.com/partio-io/cli), an open-source CLI that captures AI agent sessions alongside Git commits.

**Live site:** [docs.partio.io](https://docs.partio.io)

## Tech stack

Built with [Mintlify](https://mintlify.com). Pages are written in MDX.

## Local development

```bash
npm i -g mintlify
mintlify dev
```

This starts a local preview at `http://localhost:3000`.

## Deployment

Deployments are automatic via Mintlify's GitHub integration. Pushing to `main` triggers a build and deploy to [docs.partio.io](https://docs.partio.io).

## Adding a new page

1. Create a `.mdx` file with frontmatter (`title` and `description`)
2. Add the page path to the appropriate `navigation` group in `mint.json`

## File structure

```
mint.json                  # Site config: navigation, colors, links
introduction.mdx           # Home / introduction page
quickstart.mdx             # Quick start guide
core-concepts.mdx          # Sessions, checkpoints, strategies, worktrees
cli/
  installation.mdx         # Install instructions
  commands.mdx             # CLI command reference
  configuration.mdx        # Config files and env vars
  strategies.mdx           # Capture strategies
integrations/
  claude-code.mdx          # Claude Code integration guide
logo/                      # Logo assets (dark.svg, light.svg)
favicon.svg                # Site favicon
```

## Related repos

| Repo | Description |
|------|-------------|
| [partio-io/cli](https://github.com/partio-io/cli) | The partio CLI |
| [partio-io/site](https://github.com/partio-io/site) | Marketing website (partio.io) |
