import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export interface TextPromptProps {
  label: string;
  hint?: string;
  initialValue?: string;
  /** Show the lines the input refers to, so you can see what you are annotating. */
  quote?: string[];
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * A one-line text input.
 *
 * Hand-rolled rather than pulling in ink-text-input: it is thirty lines, and
 * the dependency list stays at four packages (PLAN §17).
 */
export function TextPrompt({
  label,
  hint,
  initialValue = '',
  quote,
  onSubmit,
  onCancel,
}: TextPromptProps) {
  const [value, setValue] = useState(initialValue);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Ignore the control keys Ink reports as empty input, and paste-safe: a
    // multi-character chunk arrives whole rather than one keystroke at a time.
    if (input && !key.ctrl && !key.meta) setValue((v) => v + input.replace(/[\r\n]+/g, ' '));
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        {label}
      </Text>
      {quote?.length ? (
        <Box flexDirection="column" marginTop={1}>
          {quote.slice(0, 6).map((line, i) => (
            <Text key={i} dimColor>
              {'> '}
              {line}
            </Text>
          ))}
          {quote.length > 6 ? <Text dimColor>{`… ${quote.length - 6} more lines`}</Text> : null}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text>{'❯ '}</Text>
        <Text>{value}</Text>
        <Text inverse> </Text>
      </Box>
      <Text dimColor>{hint ?? 'enter to save · esc to cancel'}</Text>
    </Box>
  );
}
