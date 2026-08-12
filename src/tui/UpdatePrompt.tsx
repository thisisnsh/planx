import { Picker, type PickerItem } from './Picker.js';

export type UpdateChoice = 'update' | 'skip';

export interface UpdatePromptProps {
  latest: string;
  current: string;
  onQuit?: () => void;
  onDone: (choice: UpdateChoice[]) => void;
}

/** The choice shown before an interactive review when the cache knows of an update. */
export function UpdatePrompt({ latest, current, onQuit, onDone }: UpdatePromptProps) {
  const items: Array<PickerItem<UpdateChoice>> = [
    {
      value: 'update',
      label: 'Install update',
      hint: 'runs planx update',
    },
    {
      value: 'skip',
      label: 'Skip for now',
      hint: 'asks again next time',
    },
  ];

  return (
    <Picker
      title={`Update to v${latest}?`}
      subtitle={`You are running v${current}. Install the update before opening the review, or skip it.`}
      version={current}
      sections={[{ key: 'choices', items }]}
      enterLabel="choose"
      onQuit={onQuit}
      onDone={onDone}
    />
  );
}
