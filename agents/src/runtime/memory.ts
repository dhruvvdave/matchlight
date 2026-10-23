import type { Explanation, FeedItem, Moment } from '@matchlight/schema';

/**
 * Shared memory ("blackboard") all agents read and write: what has been surfaced, when each topic was
 * last covered (for cooldowns / repetition avoidance), explanations and per-profile feeds.
 */
export class Blackboard {
  readonly moments: Moment[] = [];
  readonly explanations = new Map<string, Explanation>();
  readonly explanationByMoment = new Map<string, string>();
  readonly topicLastTs = new Map<string, number>();
  readonly kindCounts = new Map<string, number>();
  readonly feeds = new Map<string, FeedItem[]>();
  lastExplainedTs = -Infinity;

  remember(m: Moment) {
    this.moments.push(m);
    this.topicLastTs.set(m.topic, m.ts);
    this.kindCounts.set(m.kind, (this.kindCounts.get(m.kind) ?? 0) + 1);
  }

  addExplanation(e: Explanation) {
    this.explanations.set(e.id, e);
    this.explanationByMoment.set(e.moment_id, e.id);
  }

  explanationFor(momentId: string): Explanation | undefined {
    const id = this.explanationByMoment.get(momentId);
    return id ? this.explanations.get(id) : undefined;
  }

  pushFeed(item: FeedItem) {
    const list = this.feeds.get(item.profile_key) ?? [];
    list.push(item);
    if (list.length > 300) list.splice(0, list.length - 300);
    this.feeds.set(item.profile_key, list);
  }

  latest(kind: Moment['kind']): Moment | undefined {
    for (let i = this.moments.length - 1; i >= 0; i--)
      if (this.moments[i].kind === kind) return this.moments[i];
    return undefined;
  }

  reset() {
    this.moments.length = 0;
    this.explanations.clear();
    this.explanationByMoment.clear();
    this.topicLastTs.clear();
    this.kindCounts.clear();
    this.feeds.clear();
    this.lastExplainedTs = -Infinity;
  }
}
