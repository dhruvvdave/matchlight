# Data model

The single source of truth is the Zod package [`overlay-schema/src`](../overlay-schema/src). JSON Schemas are generated into [`overlay-schema/json`](../overlay-schema/json) (also reachable as [`/schema`](../schema)) with `npm run schema:gen`. A test fails if they drift.

| Schema                                               | File                         | Used by                                              |
| ---------------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `MatchEvent` (20-type discriminated union)           | `event.schema.json`          | simulator → ingest → stats → agents → UI             |
| `TrackingFrame` (1 Hz, ball + 22 players + speed)    | `tracking.schema.json`       | pitch animation, distance/speed stats, auto-eventing |
| `StreamRecord` (JSONL line: meta / event / tracking) | `stream-record.schema.json`  | replayable exports                                   |
| `MatchMeta`, `Team`, `Player`                        | `match-meta.schema.json`     | everything                                           |
| `LiveState`                                          | `live-state.schema.json`     | UI insight strips, charts                            |
| `Explanation`                                        | `explanation.schema.json`    | Explainer output contract                            |
| `FeedItem`                                           | `feed-item.schema.json`      | personalised commentary                              |
| `ViewerProfile`                                      | `viewer-profile.schema.json` | personalization                                      |
| **`Overlay`**                                        | **`overlay.schema.json`**    | **broadcast graphics engines**                       |
| `TraceSpan`                                          | `trace-span.schema.json`     | agent trace panel / logs                             |
| `Recap`                                              | `recap.schema.json`          | recap agent, exports                                 |

## Coordinates & time

- Pitch: 105 × 68 m. Coordinates are **normalised so the home team always attacks towards x = 105** (a common provider convention). `y = 68` is home's left touchline.
- `ts`: monotonic stream seconds since kick-off, including stoppage time. This is the canonical timeline, and overlay `start_ts` uses it.
- `game_s`: the football clock (the 2nd half starts at 2700). Displayed as `45+2'` via `formatMinute`.

## MatchEvent (excerpt)

```json
{
  "id": "e01369",
  "seq": 1369,
  "match_id": "m-late-comeback-1861",
  "ts": 3889.4,
  "game_s": 3829.4,
  "period": 2,
  "type": "shot",
  "team": "home",
  "player_id": "hba-03",
  "x": 99.2,
  "y": 36.1,
  "end_x": 105,
  "end_y": 35.2,
  "outcome": "goal",
  "body_part": "head",
  "situation": "open_play",
  "ball_speed_kmh": 61.3,
  "assist_id": "hba-18",
  "goalkeeper_id": "ivr-01",
  "possession_id": 312,
  "player_speed_kmh": 18.2
}
```

Types: `pass, carry, dribble, shot, goal, save, tackle, interception, clearance, block, pressure, possession_change, foul, card, substitution, offside, set_piece, tactical_shift, period_start/period_end, match_end`.

## Overlay (illustrative excerpt)

```json
{
  "id": "analyst.en:key_moment_card:0042",
  "schema_version": "1.0.0",
  "match_id": "m-late-comeback-1861",
  "profile_key": "analyst.en",
  "kind": "key_moment_card",
  "start_ts": 3772.1,
  "duration": 9,
  "priority": 82,
  "region": "right_rail",
  "position": { "x": 0.72, "y": 0.18, "w": 0.28, "h": 0.46 },
  "debounce_key": "card:pressing_shift:home",
  "language": "en",
  "dir": "ltr",
  "theme": "broadcast",
  "aria_label": "Pressing 64': Harbourside Athletic pressing harder: PPDA 9 → 2.7.",
  "source_event_ids": ["e01310", "e01322"],
  "explanation_id": "x-m0041",
  "content": {
    "title": "Pressing · 64'",
    "body": "Pressure shifted: Harbourside Athletic are winning the ball back sooner, PPDA 9 → 2.7 over the last 10 minutes after the 62' tactical switch.",
    "evidence": [
      "HBA PPDA 9.0 -> 2.7 (10-min rolling)",
      "3 of the last 4 turnovers were won by HBA in the final third"
    ],
    "confidence": 0.91,
    "icon": "tactic",
    "team": "home"
  }
}
```

- `position` is normalised **inside the title-safe area** (inner 90% of the frame), so any graphics engine can map it to its own raster. Regions are mirrored for RTL languages.
- `debounce_key`: an overlay with the same key _updates in place_ (same `id`) instead of stacking.
- `priority` 0–100: the scheduler preempts lower priorities in a region after a minimum display time, queues the rest briefly, then drops stale ones. Keys prefixed `persist:` (momentum bar, pinned metric) don't count toward the clutter cap.
- In accelerated replays (20×, 60×) durations are stretched to stay watchable; at 1× they are broadcast-real seconds.

Kinds: `lower_third`, `player_tag` (re-anchored live via `player_id`), `stat_badge` (player/ball/shot speed, distance, pass difficulty, xG, PPDA, tempo, momentum, possession; optional sparkline `series`), `momentum_bar`, `pass_map` (≤16 passes with completion + difficulty), `key_moment_card` (title, body, evidence bullets, confidence, icon).

## Fact & Explanation

```json
{
  "id": "m0041.f1",
  "label": "PPDA",
  "value": 2.7,
  "previous": 9.0,
  "delta": -6.3,
  "team": "home",
  "event_ids": ["e01310", "e01322", "e01330"],
  "text": "HBA PPDA 9.0 -> 2.7 (10-min rolling)",
  "tkey": "ppda_change",
  "params": { "team": "HBA", "from": 9.0, "to": 2.7, "w": 10 }
}
```

`tkey` + `params` let evidence be rendered in any language offline (see [`agents/src/i18n/facts.ts`](../agents/src/i18n/facts.ts)). An `Explanation` embeds the facts it relies on, so any consumer can re-verify it.

## Derived metrics

| Metric               | Definition                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **xG**               | Logistic model on distance, goal-mouth angle, header, pressure, counter; penalties 0.76.                                                                     |
| **xT-style threat**  | Smooth surface `0.004 + 0.32·e^(−d/13)·(0.35 + 0.65·min(1, angle/0.9))`; a pass or carry adds `xT(end) − xT(start)`.                                         |
| **Pass difficulty**  | Logistic on length, forward share, pressure, destination zone (final third, box), height, type (through +, back −); 0–1, shown as /10.                       |
| **PPDA**             | Opponent passes in their own 60% ÷ our tackles + interceptions + fouls in that zone; also rolling 10-minute.                                                 |
| **Momentum index**   | Exponentially-decaying (half-life 4 min) threat accumulators per team (xT gains, shots·xG, box entries, high turnovers, corners, goals), mapped to −100…100. |
| **Tempo**            | On-ball actions per minute over the last 5 minutes.                                                                                                          |
| **Control vs chaos** | 0–100 from passes per possession, turnover rate, duel rate and long-ball share over 5 minutes.                                                               |
| **Speed / distance** | From 1 Hz tracking (acceleration-limited movement model); sprints are crossings of 25.2 km/h with hysteresis.                                                |
| **Live rating**      | 6.2 baseline + goals, assists, xG, xT, key passes, ball wins, saves, pass accuracy, minus cards and fouls, soft-compressed with tanh.                        |
