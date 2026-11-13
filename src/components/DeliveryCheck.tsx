import { useState, type FormEvent } from 'react';
import { pinMessage, rememberedPin, usePinCheck, validPin } from '../store/shipping';

/**
 * "Deliver to [PIN]": the delivery date and cash on delivery for a printed book, before it's in the
 * cart. A PIN code that worked before (here or at checkout) is filled in and checked straight away.
 */
export function DeliveryCheck() {
  const [draft, setDraft] = useState(rememberedPin);
  const [pin, setPin] = useState(() => (validPin(rememberedPin()) ? rememberedPin() : ''));
  const state = usePinCheck(pin);
  const note = pinMessage(state);
  const submit = (e: FormEvent) => { e.preventDefault(); setPin(draft.trim()); };
  return (
    <form className="dlv-check" onSubmit={submit} aria-label="Check delivery to your PIN code">
      <label className="dlv-check__row">
        <span className="dlv-check__label">Deliver to</span>
        <input className="input input--white dlv-check__input" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="postal-code" placeholder="PIN code" aria-label="PIN code" maxLength={6} />
        <button type="submit" className="btn btn--outline dlv-check__go" disabled={!validPin(draft)}>Check</button>
      </label>
      {note && <p className={'co-delivery co-delivery--' + note.tone} role="status" aria-live="polite">{note.text}</p>}
      {draft.length === 6 && !validPin(draft) && <p className="co-delivery co-delivery--bad" role="status">Enter a valid 6-digit PIN code.</p>}
    </form>
  );
}
