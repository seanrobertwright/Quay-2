# Pre-PR Audit Gate & Safety Guardrails

Giving autonomous agents shell access requires safety guardrails. An agent running with `--dangerously-skip-permissions` can accidentally commit secrets or execute destructive commands.

**Quay 2** provides the **Pre-PR Audit Gate** (`Ctrl+B A`) to detect security leaks before code leaves your machine.

---

## What Does the Audit Gate Check?

```mermaid
flowchart LR
    Diff["Git Diff & Proposed Commands"] --> Gate["Quay 2 Audit Gate (Ctrl+B A)"]
    
    Gate --> Secrets["🔑 Secret & Token Scanner"]
    Gate --> Commands["⚠️ Destructive Command Filter"]
    Gate --> Perms["🛡️ Permission Mode Enforcer"]
    
    Secrets --> Report["Pass / Fail Audit Report"]
    Commands --> Report
    Perms --> Report
```

### 1. Secret & Credential Scanning
The audit gate parses all staged and unstaged git diffs across your project, searching for:
- API Keys: Anthropic, OpenAI, AWS, Google Cloud, Stripe, GitHub Personal Access Tokens.
- Private Keys: RSA, OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`), PGP keys.
- Environment files: Accidental staging of `.env`, `.env.local`, or secret config files.

### 2. Destructive Command Detection
Quay 2 monitors commands dispatched to ConPTY terminals, flagging dangerous execution patterns:
- Recursive file deletion: `rm -rf /`, `Remove-Item -Recurse -Force C:\`.
- Force pushes: `git push --force`, `git push -f origin main`.
- Hard git resets: `git reset --hard HEAD~10`.
- Arbitrary privilege elevation attempts.

### 3. Permission Indicator Badges
- Any terminal running with `--dangerously-skip-permissions` is marked with a bright red **`SKIP`** badge in the navigation rail and a warning banner across the stage.
- Terminals in standard interactive mode display clean status indicators.
