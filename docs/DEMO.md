# Sentinel — Expo demo script

A 6-minute walkthrough for a stand or a jury, on the synthetic DEMO workspace, with an optional
second part on the real CICIDS2017 benchmark. Everything shown here exists and is tested; what is not
built is said out loud (§5).

## 1. Before the day

| Check | How |
|---|---|
| Stack runs | `npm.cmd run ml:serve` and `npm.cmd run dev` ([WINDOWS_GUIDE.md](WINDOWS_GUIDE.md) §4), or `docker compose --profile demo up --build` |
| Demo workspace exists | `npm.cmd run seed:demo` (dry run), then `npm.cmd run seed:demo -- --yes` on a **dedicated** database; keep the three printed passwords in a password manager |
| Optional benchmark workspace | the `sentinel_cicids2017` database with the eight CICIDS2017 days imported and scored ([WINDOWS_GUIDE.md](WINDOWS_GUIDE.md) §8) |
| Offline backup | the screenshots in [docs/screenshots/](screenshots/) (regenerate with `npm run docs:screenshots -w @sentinel/e2e`) |
| Browser | one window at 1440 px wide, zoom 100 %, light theme; a second tab already signed in as the Viewer |

Sign in as `analyst@sentinel-demo.test` for the main path.

## 2. The pitch in one sentence (10 s)

"Sentinel is a threat-detection console for small security teams that shows **why** every alert
fired, **where** each piece of data came from, and **what it does not know**."

## 3. Main path (5 min)

1. **Command Center** (30 s). Point at the `DEMO` provenance badge: "every record says where it came
   from; this is synthetic data, and the app says so." Show the flow volume chart and the two active
   alerts. Press `Ctrl K` and type `10.0.0.66`: the palette jumps to the address.
2. **Alert** (90 s). Alerts → *SSHPatator*. Walk the three boxes: **Observed** (the 20 evidence flows,
   the rule that counted 30 attempts in 60 s, the file and its SHA-256), **Inferred** (the class, the
   MITRE technique marked *suggested*), **Unknown** ("whether the attempt succeeded"). Then the DHCP
   attribution: medium confidence, its validity window, and "an IP address alone does not identify a
   person". Click *True positive*: the change appears in the history.
3. **Incident** (60 s). Follow the incident link: "Grouped by Sentinel (hypothesis)". *Attack
   timeline*: port scan, then brute force, facts and hypotheses kept apart. *Graph* tab: the attacker,
   the target and their peers. Drag the card on the Incidents board to *Investigating* (keyboard works
   too) and show that the move is in the investigation log.
4. **Response and report** (45 s). *Response* tab: tick `10.0.0.66`, generate an nftables blocklist:
   "a simulation; Sentinel never touches a firewall." *Report* → PDF. Reports page: the executive
   report with time to triage and its limitations section.
5. **Honesty features** (45 s). Settings → Detection: the minimum confidence and allowlist, with the
   warning that trusting an address hides attacks from it. Models page: the model card with
   per-class F1 and support, not just accuracy. Switch Settings → Language to *Français* to show the
   translated navigation, then back.

## 4. Optional: the real benchmark (2 min)

Switch to the CICIDS2017 workspace (or show [EVALUATION.md](EVALUATION.md)):

- 2.83 million real flows imported and scored by the model; macro-F1 0.896 on the held-out split,
  with XSS at 0.53 and three classes too rare to estimate.
- On never-seen source addresses, 2.7 % of benign flows are flagged: that is why the noise controls
  exist. Raising the minimum confidence to 90 % cut model alerts from 1,615 to 564 and also lost 10 of
  43 alerts on real attacker traffic. "A threshold trades misses for quiet; Sentinel shows the trade."

## 5. Questions you will get

| Question | Honest answer |
|---|---|
| Does it capture live traffic? | Not yet. Flows come from CSV import (upload or CLI). A collector is the next phase. |
| Can it block the attacker? | No, by design today: it recommends, simulates blocklists and records what analysts report doing. |
| Is 0.896 good? | On CICIDS2017 itself, for most classes. It does not transfer to another network; see EVALUATION.md §5. |
| Why not just use accuracy? | 99 % accuracy hides that XSS is at 0.53 F1. Macro-F1 and per-class support are shown instead. |
| What stops one customer seeing another's data? | Every query is scoped by the organisation from the signed-in session, never from the client; tested per route. |
| How is it secured? | argon2id passwords, 15-minute access tokens in memory, rotating httpOnly refresh cookie with reuse detection, optional TOTP, RBAC per route, audit log, ASVS L1 checklist ([SECURITY_ASVS.md](SECURITY_ASVS.md)). |

## 6. If something breaks

- **ML service down:** the Command Center says "ML service unreachable"; rules and the DEMO path still
  work (the demo alerts come from rules).
- **Port 5173 busy:** stop the other dev server or use the URL Vite prints.
- **Lost demo passwords:** seed a new database name (`--mongo-uri`), never reuse the old one.
- **No network at the venue:** everything runs locally; the screenshots are the last resort.
