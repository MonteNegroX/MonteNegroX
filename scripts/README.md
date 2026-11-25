# Profile generator

`scripts/build-profile.mjs` regenerates `README.md`, the animated light/dark SVG charts in `assets/`, `llms.txt`, `llms-full.txt`, `CITATION.cff`, `AGENTS.md`, and `repos.json` from the live GitHub API so the profile never drifts from what is public.

Requires Node 22+ and an authenticated `gh` CLI (or `GH_TOKEN`). There are zero npm dependencies.

```bash
npm run build                                  # regenerate files in this checkout
node scripts/build-profile.mjs --no-activity   # catalog + repo visuals only
node scripts/build-profile.mjs --out /tmp/p    # render to another directory
npm run publish:profile                        # regenerate, commit and push to main
npm test                                       # offline unit tests
```
