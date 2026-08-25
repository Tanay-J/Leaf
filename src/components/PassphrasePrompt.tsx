import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";

interface Props {
  /** The last attempt failed — show a hint above the input. */
  wrong?: boolean;
  /** Called with the entered passphrase; parent caches it and reloads. */
  onSubmit: (passphrase: string) => void;
}

/** Overlay shown over the reading pane until the library is unlocked. */
export default function PassphrasePrompt({ wrong, onSubmit }: Props) {
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pw = value.trim();
    if (pw) onSubmit(pw);
  };

  return (
    <div className="pane-overlay">
      <form className="passphrase-gate" onSubmit={submit}>
        <Lock size={22} />
        <strong>This library is passphrase-protected</strong>
        <p className="gate-hint">
          Enter the passphrase once per session to decrypt your books.
        </p>
        {wrong && (
          <p className="gate-error">Wrong passphrase — please try again.</p>
        )}
        <input
          type="password"
          autoFocus
          placeholder="Passphrase"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Library passphrase"
        />
        <button type="submit">Unlock</button>
      </form>
    </div>
  );
}
