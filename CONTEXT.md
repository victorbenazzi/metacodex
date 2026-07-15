# metacodex

Local-first developer workspace: registered Projects, per-project Tabs, and live PTY sessions for shells and coding CLIs.

## Language

### Workspace identity

**Project**:
A registered local folder root in the app registry, with its own tabs, explorer cache, and git view.
_Avoid_: workspace (except the null bucket), repo (git may be absent), folder alone

**Project root**:
The absolute path that bounds filesystem access for a Project.
_Avoid_: cwd (that is per tab/session), workspace path

**Tab**:
A unit of open work in a Project bucket: file view, plain terminal, or CLI session UI.
_Avoid_: panel, view, window, page

**Process tab**:
A Tab of kind terminal or cli that may own a live PTY Session.
_Avoid_: agent tab (agent status is separate), shell tab only

**Preview tab**:
A file Tab opened outside any Project root via an explicit Preview grant.
_Avoid_: external file, loose file

### Sessions and agents

**PTY Session**:
A live portable-pty child process bound to at most one Process tab at a time.
_Avoid_: terminal (the Tab), shell (the program), process alone

**Session controller**:
The module that starts, stops, and handles visibility for a Process tab's PTY Session (fit, OSC/heuristic wiring, kill).
_Avoid_: TerminalTab (the React chrome), PtyManager (Rust side)

**Agent status**:
Ephemeral per-tab attention state (idle, working, needs-attention, done) derived from OSC and heuristics, not tab identity.
_Avoid_: agent (removed Agent view entities), session status alone

### Path consent

**Path authorization**:
The rule that a filesystem target must sit inside a registered Project root (empty registry denies).
_Avoid_: sandbox alone, validation, ACL

**Preview grant**:
An unforgeable capability id minted when the user opens a file outside roots (picker or OS Open With).
_Avoid_: token without "grant", path permission

**Directory grant**:
An unforgeable capability id minted when the user picks a clone parent directory.
_Avoid_: folder grant, clone path alone

### Tab policy

**Tab lifecycle**:
The module that owns open factories, open helpers (project and preview), and close policy for Tabs.
_Avoid_: useTabActions (React adapter only), tabsStore (state atom only)

**Close request**:
The decision whether closing one or more Tabs needs user confirm (because Process tabs are involved) and which tab ids are targeted.
_Avoid_: close event, kill request (kill is Session controller)

**Workspace state**:
Persisted per-Project open file tabs and explorer expansion (not Process tabs).
_Avoid_: session state, full UI state
