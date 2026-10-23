# Matchlight web: design plan

Direction: a floodlit tactics board. The screen is a match in progress drawn on a coach's board under stadium lights. Everything else stays quiet so the pitch can do the talking.

## Colour tokens

| Token          | Hex       | Where it comes from                    | Used for                                               |
| -------------- | --------- | -------------------------------------- | ------------------------------------------------------ |
| `--stand`      | `#18211F` | the shadow under a stand roof at night | page background, chrome                                |
| `--pitch`      | `#1F4430` | floodlit grass                         | the pitch, nothing else                                |
| `--chalk`      | `#ECEBE2` | line paint                             | lines, body text                                       |
| `--bib`        | `#F2862E` | a hi-vis training bib                  | live state, alerts, the focused player, primary button |
| `--marker`     | `#7FB2FF` | a blue whiteboard marker               | tactical annotations on the pitch, keyboard focus      |
| `--floodlight` | `#FFE7AE` | sodium floodlight                      | the light pools on the pitch and the scoreboard digits |

Derived: `--chalk-2` `#AEB7AE` for secondary text (8.4:1 on `--stand`), `--rule` `#33403C` for structural rules.

Kits are defined in the web layer ([`src/lib/kits.ts`](src/lib/kits.ts)) as fabric: a base colour, a trim and a pattern (hoops, halves, sash, pinstripe). Combinations were chosen so none copies a real club: teal with a salmon sash, plum and sand halves, olive and mustard hoops, and so on. No crests, no logos.

## Type roles

Two families. Both cover Latin, Arabic and Devanagari with matching weights.

| Role                         | Family                                                   | Notes                                                                                                 |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Interface, stats, scoreboard | IBM Plex Sans (+ Plex Sans Arabic, Plex Sans Devanagari) | `tabular-nums` on every number. Scoreboard digits sit on individual plates like an old stadium board. |
| Commentary voice             | Noto Serif (+ Noto Naskh Arabic, Noto Serif Devanagari)  | Line height 1.6, max 68 characters per line.                                                          |

Scale changes per channel: analyst runs 13/15 px with a 12 px table, fan runs 34 px commentary, the one-number channel sets its figure at clamp(96px, 16vw, 220px).

## Shape and elevation

- Chrome: 3 px radius, flat, no shadows. Rules separate things and always mean something (a team-coloured rule marks which team a line or stat belongs to).
- The pitch sits inside a board frame: 14 px radius, a 6 px frame like the aluminium edge of a tactics board. It is the only element with depth.
- Broadcast graphics use chamfered corners (clipped, not rounded), so they read as on-air graphics rather than UI.

## Wireframes

Analyst (1440 wide). The pitch takes the left two thirds; numbers live in one ruled table to its right.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [HBA][1][2][IVR]  64:12  live      Analyst  Fan  My club  Player  One number    EN ▾ │ ← scoreboard strip; channels are the main nav
├───────────────────────────────────────────────────────────┬──────────────────────────┤
│ ╔═══════════════════════════════════════════════════════╗ │ HBA          IVR         │
│ ║  territory shading (momentum front, wavy chalk line)  ║ │ 54%  possession   46%    │ ← one table, tabular figures,
│ ║   ┊press line 41 m      ↗ marker arrows (last passes)  ║ │ 0.95 xG          1.28    │   home column aligned start,
│ ║   ┊ (stroke weight = press intensity)    x shots       ║ │ 4.5  PPDA 10′    23.0    │   away column aligned end
│ ║   kit swatches, overlays in title-safe area           ║ │ ───────────────────────  │
│ ╚═══════════════════════════════════════════════════════╝ │ small multiples, 2×3:    │
│ 1     2        3           4    5        ← numbered key   │ xG  PPDA  momentum       │ ← same width, same baseline
│ ●─────●────────●───────────●────●──────  moments timeline │ tempo control pass diff. │
│                                                           │ ──────────────────────── │
│                                                           │ commentary, 13 px serif  │
└───────────────────────────────────────────────────────────┴──────────────────────────┘
```

Fan. Commentary first, big type, lots of empty space. The pitch shrinks and loses every annotation.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [HBA][1][2][IVR]  64:12  live      Analyst  Fan  My club  Player  One number    EN ▾ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   64′                                                                                │
│   Gentry heads it in. Harbourside are                    ╔══════════════════╗        │ ← latest line: 34 px serif,
│   back in this, and the whole ground                     ║  pitch, quiet:   ║        │   max 22 words, aligned to
│   knows it.                                              ║  shading + kits  ║        │   the same start edge as the
│                                                          ╚══════════════════╝        │   scoreboard
│   62′  Harbourside are going for it: more attackers …   (previous line, 18 px, dim)  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Player focus. The pitch crops to the player and follows them; their touches leave a trail; one running stat line.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [HBA][1][2][IVR]  64:12  live      Analyst  Fan  My club  Player  One number    EN ▾ │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  11  Marlon Jarvik, left wing                                              rating 7.4│ ← name line, rating at end edge
│ ╔══════════════════════════════════════════════════════════════════════════════════╗ │
│ ║   cropped 2.2× around the player, camera eases after them                        ║ │
│ ║        ·──·───·    ← last 12 touches joined in chalk                             ║ │
│ ║               ◉ bib-orange ring on the player                                    ║ │
│ ╚══════════════════════════════════════════════════════════════════════════════════╝ │
│  45 touches   29 of 33 passes   9.6 km   28.8 km/h top   0.19 xG                     │ ← one stat line, tabular, ticks on change
│  Commentary about this player only, 17 px serif                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

One number: the figure fills the screen. The pitch sits underneath at low contrast and shows where the latest value happened.

Alignment decisions: one start edge runs from the scoreboard down through the commentary, so in right-to-left languages the whole layout flips on that edge. Numbers align on their decimal side in tables (home start, away end). The timeline is the only numbered element because moments really are a sequence.

## Review against the defaults

I checked every part of the plan against what I would produce for any sports dashboard and changed five things:

1. **Momentum bar chart → territory on the pitch.** My first draft kept the xG race and momentum charts under the pitch. A generic dashboard does the same. Momentum now moves a chalk "front" across the pitch with team shading, and pressing appears as the weight of each team's defensive line.
2. **Near-black chrome with one neon colour → stand-shadow green with an orange bib.** That was the old look. The chrome is now the green-grey of a stand at night, and orange appears only for live state, alerts and the focused player.
3. **Numbered player dots → kit swatches.** Circles with numbers look like every match-tracker. Players are now small fabric swatches carrying the kit pattern, with the shirt number only in the analyst channel.
4. **Rounded cards → rules and one framed board.** I had started grouping the analyst stats into cards. They are now one ruled table, and the pitch frame is the only container with depth.
5. **Uppercase labels and mono numbers → sentence case and tabular Plex.** The old UI used tracked capitals and a mono face for every small number. Labels are now sentence case, and numbers use Plex Sans tabular figures.

## Copy

Sentence case, active voice. Buttons say what happens: "Pause", "Start the demo", "Open the recap", "Rewind to 64′". Every interface string exists in all five languages ([`src/lib/i18n.ts`](src/lib/i18n.ts)). Agents write the commentary in each persona's voice and language. This redesign leaves the agents untouched.
