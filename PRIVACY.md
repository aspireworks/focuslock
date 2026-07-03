# Privacy

**Short version: everything stays on your PC.**

## What Spawncamp stores

All of it locally, under `%APPDATA%\spawncamp` on your machine:

- Your settings (blocked apps, folders, sites, schedule, challenge preferences).
- Usage and progress data (block counts, streak history, daily usage tallies).
- Local log files (for the "Open logs" button, so you can attach them to
  feedback *if you choose to*).

There are **no accounts, no sign-in, no telemetry, no analytics, and no crash
reporting**. Nothing you do in Spawncamp is transmitted anywhere.

## Network access

The only network call Spawncamp makes is checking GitHub for app updates.
No personal data is sent with that check. There is no other network activity.

## What Spawncamp changes on your PC

To do its job, Spawncamp (with your admin approval via the Windows prompt):

- Adds entries to the Windows `hosts` file to block the sites you choose,
  inside a clearly marked block it manages.
- Sets browser policies that turn off DNS-over-HTTPS in Chrome, Edge, and
  Firefox, so those blocks actually apply.
- Registers a per-user scheduled task and a run-on-login entry when you turn
  on Stay-on protection.

Uninstalling Spawncamp reverses all of these. Your local settings and streak
history are kept on uninstall, so a reinstall picks up where you left off —
delete `%APPDATA%\spawncamp` yourself if you want them gone.

## Tamper-evidence, honestly

Spawncamp signs its settings files so it can *detect* out-of-band edits (they
cost your streak and show a notice). This is **tamper-evident, not
tamper-proof**: it's your PC and you have admin rights — a determined person
can defeat any of it. Spawncamp's job is to raise the cost of the impulsive
moment, not to pretend it can stop you at all costs.

## Questions

Use the **Send feedback** button in Settings.
