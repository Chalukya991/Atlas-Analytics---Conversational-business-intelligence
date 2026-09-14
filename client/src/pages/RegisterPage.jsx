import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { AuthAPI, getErrorMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import AuthLayout from '../components/layout/AuthLayout';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { Field, Input, IconInput } from '../components/ui/Field';
import { BrandMark } from '../components/layout/Brand';

function scorePassword(pw) {
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s += 1;
  return Math.min(4, s);
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const score = useMemo(() => scorePassword(password), [password]);

  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = 'Your name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) next.password = 'Include at least one letter and one number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await AuthAPI.register(name.trim(), email.trim(), password);
      setSession(data);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout eyebrow="Start in minutes">
      <div className="auth-card">
        <div className="auth-card__logo"><BrandMark light /></div>
        <h1 className="auth-card__title">Create your workspace</h1>
        <p className="auth-card__subtitle">Turn your spreadsheets into a conversation.</p>

        <form className="auth-card__form" onSubmit={submit} noValidate>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label="Full name" required error={errors.name}>
            {(id) => <Input id={id} placeholder="Ada Lovelace" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} autoComplete="name" autoFocus />}
          </Field>
          <Field label="Work email" required error={errors.email}>
            {(id) => <Input id={id} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!errors.email} autoComplete="email" />}
          </Field>
          <Field label="Password" required error={errors.password} hint="At least 8 characters with a letter and a number">
            {(id) => (
              <>
                <IconInput
                  id={id}
                  type={show ? 'text' : 'password'}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={!!errors.password}
                  autoComplete="new-password"
                  style={{ paddingLeft: 12 }}
                  suffix={
                    <button type="button" className="icon-btn icon-btn--sm" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                      {show ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  }
                />
                <div className="pw-meter" data-score={password ? score : 0} aria-hidden="true"><i /><i /><i /><i /></div>
              </>
            )}
          </Field>
          <Button type="submit" size="lg" loading={loading} block>Create workspace</Button>
        </form>

        <p className="auth-card__footer">
          Already have an account? <Link to="/login" className="auth-card__link">Sign in</Link>
        </p>
        <p className="auth-card__fine">Your files stay in your workspace and are only used to answer your questions.</p>
      </div>
    </AuthLayout>
  );
}
