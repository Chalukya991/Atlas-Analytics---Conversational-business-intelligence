import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { AuthAPI, getErrorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import AuthLayout from '../components/layout/AuthLayout';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { Field, Input, IconInput } from '../components/ui/Field';
import { BrandMark } from '../components/layout/Brand';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession, expiredMessage, clearSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const data = await AuthAPI.login(email.trim(), password);
      setSession(data);
      navigate(location.state?.from || '/dashboard', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout eyebrow="Welcome back">
      <div className="auth-card">
        <div className="auth-card__logo"><BrandMark light /></div>
        <h1 className="auth-card__title">Sign in</h1>
        <p className="auth-card__subtitle">Continue exploring your data.</p>

        <form className="auth-card__form" onSubmit={submit} noValidate>
          {expiredMessage && !error && <Alert kind="warning" onDismiss={() => clearSession('')}>{expiredMessage}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Work email" required>
            {(id) => <Input id={id} type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />}
          </Field>
          <Field label="Password" required>
            {(id) => (
              <IconInput
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                icon={undefined}
                style={{ paddingLeft: 12 }}
                suffix={
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
              />
            )}
          </Field>
          <Button type="submit" size="lg" loading={loading} block>Sign in</Button>
        </form>

        <p className="auth-card__footer">
          New to Atlas? <Link to="/register" className="auth-card__link">Create an account</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
