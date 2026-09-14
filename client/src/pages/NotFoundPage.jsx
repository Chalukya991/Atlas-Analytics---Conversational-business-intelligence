import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Button from '../components/ui/Button';

export default function NotFoundPage() {
  return (
    <div className="crash">
      <div className="card card--pad-lg crash__card">
        <div className="empty__icon" style={{ margin: '0 auto 12px' }}><Compass size={22} /></div>
        <h1 className="empty__title">Page not found</h1>
        <p className="empty__message" style={{ margin: '8px auto 0' }}>The page you are looking for does not exist or has moved.</p>
        <div className="empty__action" style={{ justifyContent: 'center' }}>
          <Link to="/dashboard"><Button>Back to overview</Button></Link>
        </div>
      </div>
    </div>
  );
}
