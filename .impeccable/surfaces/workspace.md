# Note workspace

Mode: Operate / Read. The user requested the minimalist direction established in
the sibling Photo app. Preserve Pretendard, dark neutral surfaces and Note's local
autosave, offline writing, NAS synchronization, folders, tags, recovery and backup.

Chrome uses a 17px/600 title and 48px mobile / 56px desktop header. Search is
available through the named search icon or Ctrl/Cmd+K. Sorting retains its three
choices. The note list stays title-only; a quiet neutral selection distinguishes
the active document. No gradient title, decorative eyebrow or colored selection
stripe. Desktop retains the three-column workspace for navigation and writing.

Mobile navigation fills the screen with a persistent menu toggle, keyboard focus
containment, Escape dismissal and an inert background. The same three strokes
morph into an X and back over 280ms without replacing or moving the button.
Photo-aligned mobile headers use a 44px button at (10px, 4px), title at x=58px,
17px type and 24px line height. Settings follows the same header geometry.
The header holds the close glyph, settings and download actions. Folder creation
and management remain beside the folder list. Empty tag prompts and duplicate
account/status cards are omitted. A new note is created from the main header.

The editor has a single preview/write toggle. Reading hides formatting controls;
writing keeps the horizontal formatting toolbar. Desktop focus mode remains
available in both modes. The document begins with its title and useful metadata,
with comfortable body leading and preserved font-size preferences.

Settings uses the same title scale and a full-screen mobile surface, with Tailscale,
data and writing preferences. Keep errors, sync state, connection/account details,
backup/restore explanations and storage protection information visible.

Verification: 319px mobile and 1280px desktop with synthetic local notes. Search,
navigation, settings, editor and Markdown preview checked. Typecheck, lint and
94 existing tests passed. The isolated .local preview never authenticates to the
production NAS. This refinement has not been deployed or committed.

Release refinement: mobile settings uses the persistent sidebar trigger with expanded state for its X; close returns to the list. Settings has one flat page, no tabs or duplicate APK link. Compact unboxed note list; editor toolbar has horizontal overflow and hidden scrollbar.
