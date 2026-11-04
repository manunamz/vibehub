# `data/` — your VibeHub instance (runtime, gitignored)

This directory holds a running instance's data. It's created automatically on
first run; only this README and a `.gitkeep` are committed, so the *shape* is
visible but your actual data never lands in git.

```
data/
  user.json            # editable profile (defaults to "vibybara" until renamed)
  settings.json        # default agent / distiller models
  repos/
    <repo>/
      meta.json        # name, description, createdAt
      status.json      # per-vibe pipeline state
      code/            # the agent's git history (the app)
      vibes/           # your git history (prompts, plans, PROMPT.md)
      logs/            # per-vibe agent logs
```

Run modes:

- `npm start` / `yarn start` → **use mode**, this empty `data/` dir.
- `npm run demo` / `yarn start --demo` → **demo mode**, a separate `data-demo/`
  seeded from the committed `demo/` bundles (the vibybara showcase).

Point `VIBEHUB_DATA` at any path to override.
