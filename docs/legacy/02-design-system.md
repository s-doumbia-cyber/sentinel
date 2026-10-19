# 02 — Design System Reference

This is the single standalone reference for every visual token used across the app. Both `frontend/tailwind.config.ts` (for Tailwind classes) and `frontend/src/theme/tokens.ts` (for raw values needed in chart libraries/canvas) implement these exact values — never hardcode a new hex code in a component.

## Colors

| Token | Hex | Usage |
|---|---|---|
| `base.950` | `#05060A` | Page background (deepest layer) |
| `base.900` | `#0B0F19` | Panel/sidebar background |
| `base.800` | `#10141F` | Elevated surface |
| `glass.border` | `rgba(255,255,255,0.08)` | Default glass panel border |
| `glass.borderStrong` | `rgba(255,255,255,0.14)` | Hover/active glass border |
| `neon.violet` | `#8B5CF6` | Primary accent — active states, primary gradient start |
| `neon.violetStrong` | `#A855F7` | Emphasis text, icon accents |
| `neon.pink` | `#EC4899` | Critical/high severity, secondary gradient |
| `neon.pinkStrong` | `#F0399B` | Critical badges, alert glows |
| `neon.blue` | `#3B82F6` | Info accents, secondary gradient start |
| `neon.cyan` | `#22D3EE` | Data/positive accents, cyan gradient |

### Severity palette

| Severity | Color |
|---|---|
| Critical | `#F0399B` |
| High | `#EC4899` |
| Medium | `#A855F7` |
| Low | `#22D3EE` |
| Info | `#3B82F6` |
| Safe | `#34D399` |

## Typography

| Role | Family | Usage |
|---|---|---|
| Display | Sora (500/600/700/800) | Headings, KPI numbers, page titles |
| Body | Inter (400/500/600) | Paragraph text, labels, table cells |
| Mono | Space Grotesk | IP addresses, ports, timestamps, API keys |

Type scale (Tailwind defaults are used deliberately — `text-xs` through `text-3xl` — with `font-display` applied to anything above `text-lg` and all KPI values, per the design brief's request for tight letter-spacing on headings).

## Spacing & Layout

- Base spacing unit: 8px (Tailwind's default scale already follows this; no custom overrides needed beyond what's in `tailwind.config.ts`).
- Card radius: `rounded-2xl` (1rem) everywhere; `rounded-3xl` reserved for hero/auth panels.
- Max content width: `1600px`, centered, with `p-6` page padding.
- Sidebar: 260px expanded / 84px collapsed, animated via Framer Motion spring.

## Component Tokens

| Component | Recipe |
|---|---|
| `.glass-panel` | `bg-white/[0.03]` + `backdrop-blur-xl` + `border border-white/[0.08]` + `rounded-2xl` + `shadow-panel` |
| `.glass-panel-hover` | adds `hover:border-white/[0.16]` + `hover:shadow-glow` transition |
| Gradient — violet→pink | `linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)` — primary buttons, active nav pill, KPI accents |
| Gradient — blue→violet | `linear-gradient(135deg, #22D3EE 0%, #8B5CF6 100%)` — avatars, secondary accents |
| Glow shadow (violet) | `0 0 24px rgba(139, 92, 246, 0.35)` |
| Glow shadow (pink) | `0 0 24px rgba(236, 72, 153, 0.35)` |
| Glow shadow (cyan) | `0 0 24px rgba(34, 211, 238, 0.35)` |

## Motion

- Page/card mount: fade + 12–14px upward slide, staggered by `delay` prop on `GlassCard` (Framer Motion, `easeOut`, 0.45s).
- KPI numbers: `useCountUp` hook eases from 0 to the target value over 1.2s (cubic ease-out).
- Active nav indicator: shared `layoutId` on the pill so it slides between items instead of popping.
- Notification badge / live indicators: `animate-pulse-glow` (2s ease-in-out infinite opacity pulse) — used sparingly, only for things that are genuinely live/urgent.
- Filter drawer: spring slide-in from the right (`stiffness: 280, damping: 30`).

## Signature Element

The **animated particle-field background** (`ParticleBackground.tsx`) behind every dashboard screen is this app's one deliberate "risk": faint drifting nodes with neon connective lines rendered on canvas, at low opacity so it reads as ambient network telemetry rather than decoration — reinforcing the SOC/network-monitoring subject matter without competing with the data in the foreground.
