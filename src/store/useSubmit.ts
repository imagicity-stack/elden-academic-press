import { useState, type FormEvent } from 'react';
import { errorMessage } from './api';

/** Form submit state: busy flag, error message and a sent flag. */
export function useSubmit(send: (form: HTMLFormElement) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send(e.currentTarget);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, sent, setSent, submit };
}
