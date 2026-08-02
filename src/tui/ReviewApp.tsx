import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contextSha } from '../locks/anchor.js';
import { buildAnnotation } from '../protocol/submit.js';
import { stripAnsi, truncate } from '../render/ansi.js';
import type { RenderMode } from '../render/diff.js';
import type { Annotation, AwaitRequest, Feedback } from '../store/types.js';
import { hasMouseSequence, MOUSE_OFF, MOUSE_ON, parseMouse } from './mouse.js';
import { buildModel } from './model.js';
import {
  initialSelection,
  isRowSelected,
  reduceSelection,
  scrollFor,
  spanAtCursor,
  type SelectionState,
} from './selection.js';
import { TextPrompt } from './TextPrompt.js';

export interface ReviewResult {
  action: 'submit' | 'approve' | 'reject' | 'quit' | 'unlock';
  annotations: Annotation[];
  general: string;
  /** For an unlock decision. */
  unlock?: { lockId: string; granted: boolean; note: string; requestId: string };
}

export interface ReviewAppProps {
  planId: string;
  title: string;
  versionA: number | null;
  versionB: number;
  mode: RenderMode;
  pending: AwaitRequest[];
  /** Feedback already left on this version, shown so you do not repeat yourself. */
  previous: Feedback[];
  onDone: (result: ReviewResult) => void;
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'comment'; start: number; end: number; quote: string[] }
  | { kind: 'general' }
  | { kind: 'confirm'; verdict: 'approve' | 'reject' }
  | { kind: 'unlock'; request: AwaitRequest }
  | { kind: 'help' };

const HEADER_HEIGHT = 1;
const MIN_BODY = 5;

export function ReviewApp(props: ReviewAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Ink owns stdin: useInput turns raw mode on for us, and the mouse handler
  // reads from that same stream rather than opening a second one.
  const { isRawModeSupported } = useStdin();

  const [selection, setSelection] = useState<SelectionState>(initialSelection);
  const [offset, setOffset] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<number>>(() => new Set());
  const [overlay, setOverlay] = useState<Overlay>(() => {
    const unlock = props.pending.find((r) => r.kind === 'unlock');
    return unlock ? { kind: 'unlock', request: unlock } : { kind: 'none' };
  });
  const [general, setGeneral] = useState('');
  const [mouseOn, setMouseOn] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const model = useMemo(
    () =>
      buildModel({
        planId: props.planId,
        versionA: props.versionA,
        versionB: props.versionB,
        mode: props.mode,
        expandedGaps,
        annotations,
      }),
    [props.planId, props.versionA, props.versionB, props.mode, expandedGaps, annotations],
  );

  const banner = describeBanner(props.pending);
  // Notes you left earlier that the agent has not answered yet — worth knowing
  // before you write the same thing twice.
  const openPrevious = props.previous.filter((f) => f.addressed_by === null).length;
  const footerHeight = Math.min(annotations.length, 4) + 2;
  const bodyHeight = Math.max(
    MIN_BODY,
    (stdout?.rows ?? 24) - HEADER_HEIGHT - (banner ? 1 : 0) - footerHeight - 1,
  );
  const bodyTop = HEADER_HEIGHT + (banner ? 1 : 0);

  // Keep the offset in a ref so the mouse handler, which is attached once, can
  // translate a screen row without being torn down on every scroll.
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const rowCountRef = useRef(model.rows.length);
  rowCountRef.current = model.rows.length;

  const overlayOpen = overlay.kind !== 'none';

  const move = useCallback(
    (delta: number) => {
      setSelection((s) => {
        const next = reduceSelection(s, { type: 'move', delta }, rowCountRef.current);
        setOffset((o) => scrollFor(next.cursor, o, bodyHeight, rowCountRef.current));
        return next;
      });
    },
    [bodyHeight],
  );

  /* ------------------------------------------------------------- mouse */

  // Only the terminal mode is managed here. The events themselves arrive
  // through `useInput` below — Ink reads stdin with a 'readable' listener, and
  // attaching a 'data' listener alongside it would switch the stream to flowing
  // mode and starve one of the two handlers.
  useEffect(() => {
    if (!isRawModeSupported || !mouseOn || !stdout) return;
    stdout.write(MOUSE_ON);
    return () => {
      stdout.write(MOUSE_OFF);
    };
  }, [isRawModeSupported, mouseOn, stdout]);

  const handleMouse = useCallback(
    (input: string): boolean => {
      const { events } = parseMouse(input);
      if (!events.length) return false;

      for (const event of events) {
        if (event.type === 'scroll') {
          setOffset((o) => Math.max(0, Math.min(rowCountRef.current - 1, o + event.direction * 3)));
          continue;
        }
        const index = event.row - 1 - bodyTop + offsetRef.current;
        if (index < 0 || index >= rowCountRef.current) continue;
        const type =
          event.type === 'down' ? 'mouseDown' : event.type === 'drag' ? 'mouseDrag' : 'mouseUp';
        setSelection((s) => reduceSelection(s, { type, index }, rowCountRef.current));
      }
      return true;
    },
    [bodyTop],
  );

  /* ---------------------------------------------------------- keyboard */

  useInput(
    (input, key) => {
      // Mouse sequences arrive here as ordinary input; handling them first is
      // what keeps a drag from being parsed as a burst of random commands.
      if (mouseOn && handleMouse(input)) return;
      if (hasMouseSequence(input)) return;
      setStatus(null);

      if (key.downArrow || input === 'j') return move(1);
      if (key.upArrow || input === 'k') return move(-1);
      if (key.pageDown || (key.ctrl && input === 'd')) return move(Math.floor(bodyHeight / 2));
      if (key.pageUp || (key.ctrl && input === 'u')) return move(-Math.floor(bodyHeight / 2));
      if (input === 'g') return move(-rowCountRef.current);
      if (input === 'G') return move(rowCountRef.current);

      if (input === 'V' || input === 'v') {
        return setSelection((s) => reduceSelection(s, { type: 'toggleVisual' }, model.rows.length));
      }
      if (key.escape) {
        return setSelection((s) => reduceSelection(s, { type: 'clear' }, model.rows.length));
      }

      if (input === ' ') {
        const gap = model.rows[selection.cursor]?.gapIndex;
        if (gap === null || gap === undefined) return;
        return setExpandedGaps((set) => new Set(set).add(gap));
      }

      if (input === 'm') {
        setMouseOn((on) => !on);
        return setStatus(
          mouseOn
            ? 'mouse capture off — your terminal can select text again; use V to select here'
            : 'mouse capture on',
        );
      }

      if (input === 'c' || input === 'l' || input === 'u') return startAnnotation(input);
      if (input === 'd') return deleteAnnotation();
      if (input === 'n') return setOverlay({ kind: 'general' });
      if (input === 'S') return finish('submit');
      if (input === 'A') return setOverlay({ kind: 'confirm', verdict: 'approve' });
      if (input === 'R') return setOverlay({ kind: 'confirm', verdict: 'reject' });
      if (input === '?') return setOverlay({ kind: 'help' });
      if (input === 'q') return finish('quit');
    },
    { isActive: !overlayOpen },
  );

  useInput(
    (input, key) => {
      if (overlay.kind === 'help') {
        if (key.escape || input === '?' || input === 'q') setOverlay({ kind: 'none' });
        return;
      }
      if (overlay.kind === 'confirm') {
        if (input === 'y') return finish(overlay.verdict);
        if (key.escape || input === 'n') setOverlay({ kind: 'none' });
        return;
      }
      if (overlay.kind === 'unlock') {
        if (input === 'y' || input === 'n') {
          return props.onDone({
            action: 'unlock',
            annotations: [],
            general: '',
            unlock: {
              lockId: overlay.request.lock_id ?? '',
              granted: input === 'y',
              note: '',
              requestId: overlay.request.id,
            },
          });
        }
        if (key.escape) setOverlay({ kind: 'none' });
      }
    },
    {
      isActive: overlay.kind === 'help' || overlay.kind === 'confirm' || overlay.kind === 'unlock',
    },
  );

  function startAnnotation(kind: 'c' | 'l' | 'u') {
    const span = spanAtCursor(model.rows, selection);
    if (!span) {
      return setStatus('nothing to annotate there — that row is a deletion or a collapsed gap');
    }
    const quote = model.docLines.slice(span.start - 1, span.end);

    if (kind === 'c') {
      return setOverlay({ kind: 'comment', start: span.start, end: span.end, quote });
    }
    addAnnotation(kind === 'l' ? 'lock' : 'unlock', span.start, span.end, '');
    setStatus(
      kind === 'l'
        ? `locked lines ${span.start}–${span.end} (applies on submit)`
        : `unlocked lines ${span.start}–${span.end} (applies on submit)`,
    );
    setSelection((s) => reduceSelection(s, { type: 'clear' }, model.rows.length));
  }

  function addAnnotation(kind: Annotation['kind'], start: number, end: number, comment: string) {
    setAnnotations((current) => {
      const id = `${kind === 'comment' ? 'a' : kind === 'lock' ? 'L' : 'u'}${current.filter((a) => a.kind === kind).length + 1}`;
      const annotation = buildAnnotation(
        model.docLines,
        kind,
        start,
        end,
        comment,
        id,
        contextSha(model.docLines, { start: start - 1, end: end - 1 }),
      );
      return [...current, annotation];
    });
  }

  function deleteAnnotation() {
    const line = model.rows[selection.cursor]?.newLine;
    if (line === null || line === undefined) return;
    const hit = [...annotations]
      .reverse()
      .find((a) => a.anchor.start_line <= line && a.anchor.end_line >= line);
    if (!hit) return setStatus('no annotation on this line');
    setAnnotations((current) => current.filter((a) => a.id !== hit.id));
    setStatus(`removed ${hit.id}`);
  }

  function finish(action: ReviewResult['action']) {
    if (action === 'submit' && annotations.length === 0 && !general.trim()) {
      return setStatus('nothing to submit — add a comment with c, or press q to leave');
    }
    props.onDone({ action, annotations, general });
  }

  useEffect(() => () => exit(), [exit]);

  /* ------------------------------------------------------------ render */

  const width = stdout?.columns ?? 100;
  const visible = model.rows.slice(offset, offset + bodyHeight);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan" bold>
          planx
        </Text>
        <Text dimColor>{' · '}</Text>
        <Text>{props.planId}</Text>
        <Text dimColor>{' · '}</Text>
        <Text>
          v{props.versionB}
          {props.versionA === null ? '' : ` ← v${props.versionA}`}
        </Text>
        <Text dimColor>{' · '}</Text>
        <Text color="yellow">REVIEW</Text>
        {model.locks.sealed_at ? <Text color="green">{' · SEALED'}</Text> : null}
      </Text>

      {banner ? (
        <Text backgroundColor="yellow" color="black">
          {` ${banner} `}
        </Text>
      ) : null}

      <Box flexDirection="column">
        {visible.map((row, i) => {
          const index = offset + i;
          const selected = isRowSelected(selection, index);
          const cursor = index === selection.cursor;
          const text = truncate(selected ? stripAnsi(row.text) : row.text, width - 1);
          return (
            <Text key={index} inverse={selected} bold={cursor && !selected}>
              {text}
            </Text>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {annotations.slice(-4).map((a) => (
          <Text key={a.id} dimColor>
            {a.kind === 'comment' ? '●' : a.kind === 'lock' ? '🔒' : '🔓'} {a.id}{' '}
            {`L${a.anchor.start_line}–${a.anchor.end_line}`}{' '}
            {a.comment ? `"${truncate(a.comment, 60)}"` : `(${a.kind})`}
          </Text>
        ))}
        {general.trim() ? <Text dimColor>{`note: ${truncate(general, 70)}`}</Text> : null}
        {openPrevious > 0 ? (
          <Text dimColor>
            {`${openPrevious} earlier note${openPrevious === 1 ? '' : 's'} on this version is still waiting for the agent`}
          </Text>
        ) : null}
        {status ? <Text color="yellow">{status}</Text> : null}
        <Text dimColor>
          {
            'drag/V select · c comment · l lock · u unlock · d del · n note · S submit · A approve · ? help'
          }
        </Text>
      </Box>

      {overlay.kind === 'comment' ? (
        <TextPrompt
          label={`Comment on lines ${overlay.start}–${overlay.end}`}
          quote={overlay.quote}
          onSubmit={(value) => {
            if (value.trim()) addAnnotation('comment', overlay.start, overlay.end, value.trim());
            setOverlay({ kind: 'none' });
            setSelection((s) => reduceSelection(s, { type: 'clear' }, model.rows.length));
          }}
          onCancel={() => setOverlay({ kind: 'none' })}
        />
      ) : null}

      {overlay.kind === 'general' ? (
        <TextPrompt
          label="General note (applies to the whole plan)"
          initialValue={general}
          onSubmit={(value) => {
            setGeneral(value);
            setOverlay({ kind: 'none' });
          }}
          onCancel={() => setOverlay({ kind: 'none' })}
        />
      ) : null}

      {overlay.kind === 'confirm' ? (
        <Box
          borderStyle="round"
          borderColor={overlay.verdict === 'approve' ? 'green' : 'red'}
          paddingX={1}
          flexDirection="column"
        >
          <Text bold>
            {overlay.verdict === 'approve'
              ? `Approve v${props.versionB}? This seals the plan — every section becomes locked.`
              : `Reject v${props.versionB}? The agent will stop and ask.`}
          </Text>
          <Text dimColor>y to confirm · n or esc to cancel</Text>
        </Box>
      ) : null}

      {overlay.kind === 'unlock' ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text bold color="yellow">
            {`The agent asks to unlock ${overlay.request.lock_id}`}
          </Text>
          <Text>{`Reason: ${overlay.request.reason || '(none given)'}`}</Text>
          {overlay.request.proposed ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Proposed replacement:</Text>
              {overlay.request.proposed
                .split('\n')
                .slice(0, 8)
                .map((line, i) => (
                  <Text key={i} color="green">
                    {`+ ${line}`}
                  </Text>
                ))}
            </Box>
          ) : null}
          <Text dimColor>y to grant (single use) · n to deny · esc to decide later</Text>
        </Box>
      ) : null}

      {overlay.kind === 'help' ? <HelpOverlay /> : null}
    </Box>
  );
}

function HelpOverlay() {
  const rows: Array<[string, string]> = [
    ['j k ↑ ↓', 'move the cursor'],
    ['ctrl-d / ctrl-u', 'half a page'],
    ['g / G', 'top / bottom'],
    ['V', 'start or end a line selection'],
    ['drag', 'select with the mouse (always whole lines)'],
    ['m', 'toggle mouse capture, so the terminal can select text again'],
    ['space', 'expand the collapsed run under the cursor'],
    ['c', 'comment on the selection'],
    ['l / u', 'lock / unlock the selection'],
    ['d', 'delete the annotation under the cursor'],
    ['n', 'general note about the whole plan'],
    ['S', 'submit everything at once'],
    ['A / R', 'approve (seals the plan) / reject'],
    ['q', 'leave without submitting'],
  ];
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        planx review
      </Text>
      {rows.map(([keys, what]) => (
        <Text key={keys}>
          <Text color="yellow">{keys.padEnd(18)}</Text>
          <Text dimColor>{what}</Text>
        </Text>
      ))}
      <Text dimColor>any key to close</Text>
    </Box>
  );
}

function describeBanner(pending: AwaitRequest[]): string | null {
  const unlock = pending.find((r) => r.kind === 'unlock');
  if (unlock) return `agent requests unlock of ${unlock.lock_id}`;
  if (pending.length) return 'agent is waiting — submit to unblock it';
  return null;
}
