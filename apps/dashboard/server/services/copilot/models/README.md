# Model artifacts — download target, never source

This directory holds the WS-7 T13 model artifact's **bytes**. Nothing in it is
tracked; `.gitignore` in this directory excludes everything except itself and
this file.

## What belongs here

One file: `needle3.cact` — Needle 3 (`Cactus-Compute/needle3`, Apache-2.0), the
model T13's manifest pins. Its size and SHA-256 are recorded as data in
`../modelManifest.mjs`, which is the only place they are written down.

## How to put it here

From the repository root:

    node scripts/model-digest-gate.mjs --fetch

The gate downloads from the pinned URL, then verifies the digest **before**
accepting the file. A download whose digest does not match the pin is deleted
and the gate fails. Do not hand-place a file here: a file that arrived without
passing the gate is exactly the thing D15 exists to prevent.

## The two rules this directory is subject to

1. **D15** — a model without a pinned SHA-256 cannot be loaded, and the gate
   fails the build. A missing artifact is a **failure**, not a skip.
2. **safetensors or `.cact` only** — and the check reads the file's bytes, so a
   pickle renamed `model.safetensors` is refused. See
   `../modelLayer/artifactFormat.mjs`.

## Why the bytes are not committed

A 35 MB binary in git is a permanent, unreviewable, un-deletable blob that every
clone pays for, and it is a third party's artifact rather than this
repository's source. The pin — which is the part that carries meaning — *is*
committed, in `../modelManifest.mjs`.
