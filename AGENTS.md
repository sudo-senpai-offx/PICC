<!-- picc-ai-skills:start -->
## AI Skills (run every session)

At the start of EVERY session in this repo, run:

    node scripts/setup-ai-skills.mjs --check

It verifies the globally-installed OpenCode skills (mattpocock/skills engineering bundle +
security-review) are present and fresh, and self-heals them when they are not. Then actually USE them:
prefer the matching skill for the task at hand (tdd, diagnosing-bugs, code-review, grilling,
research, security-review for auth/payment/broker diffs, writing-for-agents for docs) instead of
improvising process from scratch.
<!-- picc-ai-skills:end -->
