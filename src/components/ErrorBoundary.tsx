import { Component, type ReactNode } from 'react';

/** Shows a way out instead of a blank page if something fails to render. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <p>Something went wrong loading this page.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
