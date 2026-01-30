# Tool Usage Rules

**Last updated:** 2026-01-30

This document defines the tool usage rules for AI agents in LumenFlow workflows.

---

## Golden Rules

1. **Use dedicated tools**: Prefer Grep/Read/Glob over shell equivalents
2. **Bash is for execution**: Use Bash for git, npm, builds - not file reading
3. **Hooks enforce discipline**: PreToolUse hooks block violating commands
4. **Better UX**: Dedicated tools have proper permissions and formatting

---

## Blocked Shell Commands

These commands are blocked in Bash tool calls because dedicated tools exist:

| Command         | Use Instead                     | Why                                              |
| --------------- | ------------------------------- | ------------------------------------------------ |
| `grep` / `rg`   | **Grep tool**                   | Better permissions, structured output            |
| `cat`           | **Read tool**                   | Line numbers, image support, truncation handling |
| `head` / `tail` | **Read tool** with offset/limit | Proper file reading semantics                    |
| `find`          | **Glob tool**                   | Faster, returns sorted by modification time      |
| `sed`           | **Edit tool**                   | Proper diff tracking, undo support               |
| `awk`           | **Edit tool** or code           | More maintainable transformations                |
| `echo > file`   | **Write tool**                  | Proper permissions, file tracking                |

---

## Allowed Bash Commands

These commands are allowed because no dedicated tool exists:

```bash
# Git operations
git status
git add
git commit
git push
git log
git diff

# Package management
pnpm install
pnpm build
pnpm test

# Build tools
npm run build
make

# System commands
ls -la          # Directory listing (Glob is for patterns)
pwd
mkdir -p
rm -rf          # With appropriate safeguards

# Process management
ps
kill
```

---

## Why This Matters

### 1. Permissions and Security

Dedicated tools have proper permission models:

- Read tool respects `.env` file restrictions
- Write tool enforces worktree discipline
- Grep tool has appropriate timeout handling

### 2. Better Output Formatting

Dedicated tools format output for LLM consumption:

- Line numbers for context
- Truncation with clear indicators
- Structured JSON where appropriate

### 3. Audit Trail

Tool calls are logged and can be reviewed:

- File operations tracked
- Patterns recorded
- Violations blocked with clear messages

### 4. Error Handling

Dedicated tools provide better error messages:

- File not found with suggestions
- Permission denied with fix commands
- Path validation with clear guidance

---

## Exception Handling

In rare cases, shell commands may be needed when dedicated tools cannot handle a use case:

### Legitimate Exceptions

```bash
# Piping build output through grep (process output, not files)
pnpm build 2>&1 | grep -i error

# Using find with -exec for batch operations
# (Glob finds files, but find can execute commands)
# Note: Still prefer dedicated tools when possible

# Processing command output, not files
git log --oneline | head -20
```

### NOT Legitimate Exceptions

```bash
# WRONG: Reading files
cat package.json          # Use Read tool

# WRONG: Searching file contents
grep "TODO" src/**/*.ts   # Use Grep tool

# WRONG: Finding files
find . -name "*.test.ts"  # Use Glob tool

# WRONG: Editing files
sed -i 's/old/new/g' file # Use Edit tool
```

---

## Hook Enforcement

The `block-bash-file-commands.sh` PreToolUse hook:

1. Parses the Bash command from tool input
2. Detects blocked commands (grep, cat, find, etc.)
3. Blocks with a clear error message
4. Suggests the appropriate dedicated tool

### Exit Codes

- `0` = Allow the command
- `2` = Block the command (message shown to agent)

### Bypass

If you have a legitimate need to use a blocked command:

1. Document the reason in your commit message
2. The hook will suggest alternatives - use them if possible
3. If truly necessary, discuss with the team about adding an exception

---

## Configuration

The hook can be configured via environment variables:

```bash
# Disable hook (NOT RECOMMENDED - for debugging only)
LUMENFLOW_TOOL_GUARD_DISABLED=1

# Warn instead of block
LUMENFLOW_TOOL_GUARD_MODE=warn
```

---

## Related Rules

- [git-safety.md](./git-safety.md) - Git command restrictions
- [wu-workflow.md](./wu-workflow.md) - Work unit lifecycle
- [tdd-workflow.md](./tdd-workflow.md) - Test-driven development
