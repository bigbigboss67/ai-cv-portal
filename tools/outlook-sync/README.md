# Outlook sync helper

Keeps the portal's application tracker up to date from classic Outlook on this PC:

- **Draft ready → Applied** when the application shows up in Sent Items (with the real send date).
- **Replies** are read and matched to their application: acknowledged, info requested,
  interview, offer, rejected, bounced, auto-reply. Clear ones apply themselves; unsure ones
  wait under "To confirm" in the tracker. Every automatic change has an Undo.

It is **read-only** (never sends, moves or deletes mail), reads **one account only**
(`rassemkadiri@live.de` by default), listens on `127.0.0.1` only, and answers only the
portal's own pages. No Azure, no passwords.

## Install (once)

Needs classic Outlook (`Outlook (classic)` in the Start menu) with the account added.

```powershell
powershell -ExecutionPolicy Bypass -File tools\outlook-sync\install.ps1
```

It copies itself to `%LOCALAPPDATA%\AI-CV-Portal-Outlook-Sync`, starts now, and starts
hidden at every log-in. The first time the portal contacts it, Chrome may ask to allow
access to devices on your local network — allow it.

Other account: `install.ps1 -Account you@example.com`.

## Check / remove

- Check: open http://127.0.0.1:47321/health — it shows the account it reads.
- Self-test (prints counts only): `powershell -ExecutionPolicy Bypass -File outlook-sync.ps1 -SelfTest`
- Remove: `powershell -ExecutionPolicy Bypass -File tools\outlook-sync\uninstall.ps1`
