# Nudge Preview (Buzz plugin)

Buzz shows `.html` attachments as code. This plugin plays them: tap an `.html` file card in any
Buzz chat and a side panel runs it live in a 390×844 phone frame, with a Replay button.

Built for CleverTap custom-HTML in-app nudges:
- `CleverTap.*` and iOS `webkit.messageHandlers.*` calls are stubbed. Every event (name + properties)
  is listed under the phone; nothing is sent anywhere.
- Links and deep links are captured as events, not opened.
- Buzz's CSP (`script-src 'self' blob:`) blocks inline scripts in embedded frames, so the plugin moves every inline
  script and `on*` handler into `blob:` scripts and plays the result in a same-origin frame. That frame runs with
  Buzz's access, so **only files sent by trusted pubkeys** (the `TRUSTED` list in `plugin.js`) get the player;
  others keep the normal file card.

## Install
Buzz → Settings → Plugins → Manage plugins → Add → paste `jermylovespets/buzz-nudge-preview` → Find → Install.

## How it works
One ES module (`plugin.js`, plugin API v1):
- `conversation.registerAttachment` claims `.html` files at order `-10`, ahead of the built-in file viewer.
- A `panels` panel renders the preview.
