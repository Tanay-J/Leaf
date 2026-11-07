import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";

interface Props {
  /** The last attempt failed — show a hint above the input. */
  wrong?: boolean;
  /** Called with the entered passphrase; parent caches it and reloads. */
  onSubmit: (passphrase: string, remember: boolean) => void;
}

/** Overlay shown over the reading pane until the library is unlocked. */
export default function PassphrasePrompt({ wrong, onSubmit }: Props) {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pw = value.trim();
    if (pw) onSubmit(pw, remember);
  };

  return (
    <div className="pane-overlay">
      <form className="passphrase-gate" onSubmit={submit}>
        <Lock size={22} />
        <strong>This library is passphrase-protected</strong>
        <p className="gate-hint">
          Enter the passphrase to decrypt your books.
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
        <label className="gate-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember on this device</span>
        </label>
        <button type="submit">Unlock</button>
      </form>
    </div>
  );
}