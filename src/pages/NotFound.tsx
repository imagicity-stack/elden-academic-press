import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="wrap not-found">
      <h1 className="h1-page">Page not found</h1>
      <p className="body body--15">The page you were looking for has moved or doesn't exist.</p>
      <div><Link to="/catalogue" className="btn btn--navy">Browse the catalogue</Link></div>
    </div>
  );
}
