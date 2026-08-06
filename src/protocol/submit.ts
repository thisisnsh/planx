import { sectionOf } from '../render/markdown.js';
import { ulid } from '../store/ids.js';
import { readVersionText, reindex } from '../store/plans.js';
import { contextSha, normalizedLines } from '../store/text.js';
import { feedbackFor, writeFeedback } from '../store/feedback.js';
import { FeedbackSchema, type Annotation, type Feedback } from '../store/types.js';

export interface SubmitInput {
  planId: string;
  version: number;
  annotations: Annotation[];
  general?: string;
}

export interface SubmitResult {
  feedback: Feedback;
}

/**
 * Land everything the reviewer did in one shot: every comment, and the note.
 *
 * One submit rather than a call per annotation is the point of the TUI — you
 * select three ranges, write on each, and it all arrives in the agent's context
 * together.
 *
 * It replaces the version's record rather than adding to it, so an empty set of
 * annotations is a meaningful submit: it is how deleting the last comment on a
 * version lands.
 */
export function submitFeedback(input: SubmitInput): SubmitResult {
  const text = readVersionText(input.planId, input.version);
  if (text === null) {
    throw new Error(`planx: ${input.planId} has no stored v${input.version} to review.`);
  }
  const docLines = normalizedLines(text);
  reindex(input.planId);

  // One record per version, rewritten in place — so the id is the one already
  // on it. Minting a new one every submit would leave a version's feedback with
  // a different identity each time the reviewer touched it.
  //
  // `addressed_by` survives too. It says a later version answered this one,
  // which stays true however the reviewer edits the words; dropping it on a
  // rewrite would reopen feedback that a captured version had already closed.
  const stored = feedbackFor(input.planId, input.version);
  const feedback = FeedbackSchema.parse({
    id: stored?.id ?? ulid(),
    plan_id: input.planId,
    version: input.version,
    annotations: input.annotations.map((a) => reanchor(a, docLines)),
    general: input.general ?? '',
    created: new Date().toISOString(),
    addressed_by: stored?.addressed_by ?? null,
  });
  writeFeedback(feedback);

  return { feedback };
}

/**
 * Re-read a comment's quote, section and context from the version as it stands.
 *
 * A submit that follows an in-place edit is anchored to lines the reviewer has
 * just rewritten. The anchor itself is a line number and a line count, neither
 * of which an edit can change, so the comment keeps its place — but the quote it
 * carried is what the line used to say, and the agent acts on the quote. On an
 * untouched version this is a no-op that rewrites the same three fields.
 */
function reanchor(annotation: Annotation, docLines: string[]): Annotation {
  const { start_line: start, end_line: end } = annotation.anchor;
  if (start < 1 || end > docLines.length) return annotation;
  return {
    ...annotation,
    anchor: {
      ...annotation.anchor,
      context_sha: contextSha(docLines, { start: start - 1, end: end - 1 }),
    },
    quote: docLines.slice(start - 1, end).join('\n'),
    section: sectionOf(docLines, start - 1),
  };
}

/** Build a comment annotation from a line selection, filling in quote and section. */
export function buildAnnotation(
  docLines: string[],
  startLine: number,
  endLine: number,
  comment: string,
  id: string,
  contextSha = '',
): Annotation {
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  return {
    id,
    kind: 'comment',
    anchor: { start_line: start, end_line: end, context_sha: contextSha },
    quote: docLines.slice(start - 1, end).join('\n'),
    comment,
    section: sectionOf(docLines, start - 1),
  };
}
