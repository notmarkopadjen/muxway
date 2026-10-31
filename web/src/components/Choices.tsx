import { useAnswer } from '../api/queries';
import type { Attention } from '../api/types';
import { useToast } from './Toast';

// The fixed answers of a question a pane asked with muxway ask, as
// buttons: a click sends the choice to the asking process; the pane's
// attention goes with it. Nothing is typed into the pane.
export function Choices({
  address,
  attention,
  writable,
}: {
  address: string;
  attention?: Attention;
  writable: boolean;
}) {
  const answer = useAnswer();
  const toast = useToast();
  if (!attention?.choices?.length) return null;
  return (
    <span className="mx-choices" data-testid="choices">
      {attention.choices.map((c) => (
        <button
          key={c}
          type="button"
          disabled={!writable || answer.isPending}
          title={writable ? `answer: ${c}` : 'read-only: you cannot answer here'}
          onClick={(e) => {
            e.stopPropagation();
            answer.mutate(
              { address, choice: c },
              {
                onError: (err) => toast.push({ kind: 'answer', title: address, text: String(err) }),
              },
            );
          }}
        >
          {c}
        </button>
      ))}
    </span>
  );
}
