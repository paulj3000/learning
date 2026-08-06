import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main id="main-content">
      <h1>Page not found</h1>
      <p>Let&apos;s head back to the island.</p>
      <Link to="/">Return home</Link>
    </main>
  );
}
