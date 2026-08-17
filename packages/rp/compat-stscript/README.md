# `@dsh-rp/compat-stscript`

English | [中文](README.zh.md)

Permission-gated L1 compatibility for the safe, deterministic subset of SillyTavern STscript and Quick Replies. It supports pipe values, local/global variables, bounded arithmetic, `{{pipe}}` and variable macros, output, and calls into an explicitly supplied Quick Reply library.

The interpreter is pure and fail-closed. It has no model, message, network, filesystem, shell, arbitrary JavaScript, extension, or Host access. Source size, commands, call depth, variable count, serialized state, output, cancellation, and capability budgets are enforced at the execution boundary. Installation alone does not authorize execution; callers need `script.execute`.

## Model Experience

None, as the interpreter only returns detached JSON and does not assemble model input.

#### KV Cache effect

None until another plugin deliberately renders an execution result into model context.

## Known Limitations and Deferred Work

- This is intentionally not full SillyTavern emulation. Generation, chat mutation, delays, loops, closures, UI commands, HTTP, files, extensions, and arbitrary code are rejected.
- Quick Reply libraries must be supplied explicitly per invocation; the package does not scan user or application directories.
- Additional commands can be added as separately reviewed semantic adapters without broadening the interpreter's ambient authority.
