import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuthMethods } from '../api/queries';
import { useSession } from '../auth/session';
import { Box } from '../components/Box';

const BOOT = [
  'muxway terminal gateway',
  'checking hub ........ ok',
  'loading sign-in methods',
  'ready.',
];

function Boot() {
  // Each line types itself out after the previous one.
  return (
    <div className="mx-boot" aria-hidden="true">
      {BOOT.map((line, i) => (
        <div key={line}>
          <span
            className={`mx-typed${line.endsWith('ok') || line === 'ready.' ? ' ok' : ''}`}
            style={
              {
                '--mx-type-delay': `${300 + i * 450}ms`,
                '--mx-type-steps': line.length,
              } as React.CSSProperties
            }
          >
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SignInPage() {
  const methods = useAuthMethods();
  const { signedIn, signInWithToken } = useSession();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (signedIn) navigate({ to: '/' });
  }, [signedIn, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithToken(token.trim());
      setToken('');
      navigate({ to: '/' });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'that token was not accepted'
          : err instanceof ApiError && err.status === 429
            ? 'too many attempts, try again later'
            : 'the hub could not be reached',
      );
    } finally {
      setBusy(false);
    }
  };

  const providers = (methods.data?.methods ?? []).filter((m) => m !== 'token');
  return (
    <div className="mx-signin">
      <Boot />
      <Box title="sign in" testId="signin">
        {providers.map((name) => {
          const p = methods.data?.[name];
          const label = p && !Array.isArray(p) ? p.label : name;
          return (
            <a
              key={name}
              className="mx-provider"
              href={`/v1/auth/${name}/start`}
              data-testid={`provider-${name}`}
            >
              {label}
            </a>
          );
        })}
        {providers.length > 0 && <div className="mx-or">── or paste a token ──</div>}
        <form onSubmit={submit}>
          <input
            type="password"
            autoComplete="off"
            placeholder="mxt_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            data-testid="token"
            aria-label="token"
          />
          <button type="submit" disabled={busy || !token.trim()} data-testid="token-submit">
            sign in
            <span className="mx-cursor" aria-hidden="true" />
          </button>
        </form>
        {error && (
          <div className="mx-error" role="alert" data-testid="signin-error">
            {error}
          </div>
        )}
        {methods.isError && <div className="mx-error">the hub could not be reached</div>}
      </Box>
    </div>
  );
}
