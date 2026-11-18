# Nudge Preview (Buzz plugin)

Buzz shows `.html` attachments as code. This plugin plays them: tap an `.html` file card in any
Buzz chat and a side panel runs it live in a 390×844 phone frame, with a Replay button.

Built for CleverTap custom-HTML in-app nudges:
- `CleverTap.*` and iOS `webkit.messageHandlers.*` calls are stubbed. Every event (name + properties)
  is listed under the phone; nothing is sent anywhere.
- Links and deep links are captured as events, not opened.
- The file runs in a sandboxed iframe (`allow-scripts` only, no same-origin access to Buzz).

## Install
Buzz → Settings → Plugins → Manage plugins → Add → paste `SupertailsPCPL/buzz-nudge-preview` → Find → Install.

## How it works
One ES module (`plugin.js`, plugin API v1):
- `conversation.registerAttachment` claims `.html` files at order `-10`, ahead of the built-in file viewer.
- A `panels` panel renders the preview.
