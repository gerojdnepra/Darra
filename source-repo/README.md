# Darra Terminal Source Recovery

This directory is a recovery scaffold for bringing the project back to a normal source repository.

It is not the original source tree.

What we actually have in the workspace:

- an installed Electron application bundle in `../Darra Terminal/`
- an unpacked installer copy in `../installer-unpacked/`
- a backend bundled into one large `index.cjs`
- a compiled Next.js frontend bundle

What this scaffold provides:

- a sane repository layout
- a module map recovered from the shipped artifacts
- an `env.example` without secrets
- a concrete recovery plan

Recommended goal:

1. Recover or obtain the original git repository.
2. Use the files in this folder only as a migration target and documentation aid.
3. Move from artifact-based maintenance back to source-based maintenance.
