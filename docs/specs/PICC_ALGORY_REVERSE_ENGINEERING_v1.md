# PICC — Algory Reverse-Engineering Project (v1)

- **Status:** DRAFT — plan agreed in scope (owner Q5: "everything required to generate a full-fledged spec,
  100% understandable by AI agents"); execution pending owner approval to proceed. · **Resolution:** COMPLETE — the research project the plan specified was executed and its deliverable (`docs/specs/PICC_ALGORY_FINDINGS_v1.md`) was produced; the plan's own "DRAFT / execution pending approval" line is stale post-execution (**Date:** 2026-09-19)
- **Goal:** extract everything from the Algory installer → produce an AI-agent-readable findings spec that
  feeds trading-suite improvement (and the earnings trust gate, which depends on trading-suite health).
- **Artifact:** `C:\Users\sharv\Downloads\Algory_Setup_1.5.1.3.3.exe`

## 1. Verified findings so far

| Item | Finding | Evidence |
|---|---|---|
| Signature | Valid Authenticode, **VAGAFX LTD, London GB** | `Get-AuthenticodeSignature` |
| PE | x64 GUI, VS2022 linker 14.44, `requireAdministrator` manifest, WebView2 marker in overlay | PE headers + manifest |
| Payload | 247.9 MB single `[0]` section | 7-Zip listing |
| Container | **TclApp-style VFS**: zlib-wrapped index header (289 B; blob-count 2, entry-count 0x2EF3 = 12019) + UTF-16 name table tail (`_algory\_tcl_data\tzdata\…`) | Node zlib probe + tail scan |
| Interpretation | **Tcl/Tk desktop application** with WebView2 component; Tcl is interpreted → unpack = decompile (readable `.tcl`), no binary lifting needed | layout + markers |

## 2. Work plan

1. **Build the VFS unpacker** (Node or Python): parse the zlib index header + trailer name table →
   offset/size map → extract every entry, reconstruct the file tree (~12k entries expected).
2. **Inventory:** app entry points (`_algory\*`), Tcl stdlib vs app code, tcl_data, assets, WebView2 parts.
3. **Static analysis of `.tcl` sources:** feature map (rooms/flows/buttons), network calls (endpoints,
   REST/WS), data collection, auth/key handling, order/trade logic, indicator math, update channels.
4. **Security review:** what it sends off-machine, key storage, signed-update behavior, persistence.
5. **Output:** `docs/specs/PICC_ALGORY_FINDINGS_v1.md` — feature map, endpoint inventory, logic summaries,
   security notes, and a "what PICC can borrow" list feeding the trading-suite improvement spec.

## 3. Acceptance

- Unpacker reproduces the trailer structure (entry count ~12019, `_algory\_tcl_data\tzdata\` layout intact).
- Findings doc contains: feature map, endpoint inventory, logic summaries, security notes, borrow list —
  all AI-agent-readable (exact paths, tables, no prose guessing).

## 4. Guardrails

- **Never execute the installer on the host** (requireAdministrator, third-party Tcl/Tk app). If runtime
  behavior is ever needed → sandbox/VM only.
- Owner-provided download links for Chrome-extension candidates feed the same findings pipeline.
- 7-Zip 26.03 installed via winget this session (tool, reported).

---

## Resolution (2026-09-19)

**Disposition: COMPLETE** — the reverse-engineering project this plan scoped produced its planned deliverable.

**Evidence:** `docs/specs/PICC_ALGORY_FINDINGS_v1.md` exists and names this file as its plan (`"Plan: docs/specs/PICC_ALGORY_REVERSE_ENGINEERING_v1.md"`); the extraction was performed (2,511 files unpacked from the installer, outside the repo) — commit `ed81b5f` created both files. §3 acceptance's "findings doc contains feature map, endpoint inventory, logic summaries, security notes, borrow list" is met by the findings doc (§2–§8).

**One honest correction recorded:** §1's "verified findings" (TclApp-style VFS, `Tcl/Tk`, ~12,019 entries) were revised by actual execution — the findings doc establishes a **PyInstaller** `PYZ.pyz` bundle (PyArmor-encrypted, 2,511 files, `.pyc` residue) with customtkinter/WebView2, not TclApp. The findings doc is authoritative over the plan's preliminary interpretation.

**Nothing supersedes this plan** (research-end; natural disposition archive-equivalent, but the plan itself was fully executed — hence COMPLETE with a stale-status note).