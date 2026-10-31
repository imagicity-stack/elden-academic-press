import { Link } from 'react-router-dom';
import { Arrow } from '../components/motion';

export function NotFound() {
  return (
    <div className="wrap not-found">
      <div className="not-found__n" aria-hidden="true">404</div>
      <h1 className="t-h2">This page isn’t in <span className="serif-i">this edition.</span></h1>
      <p className="t-lead">The page you were looking for has moved or doesn’t exist.</p>
      <div className="not-found__ctas">
        <Link to="/catalogue" className="btn btn--ink btn--lg">Browse the store <Arrow /></Link>
        <Link to="/" className="btn btn--outline btn--lg">Home</Link>
      </div>
    </div>
  );
}
