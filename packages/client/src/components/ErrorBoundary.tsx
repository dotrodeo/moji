import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StickerButton, Wordmark } from '../ui.js';

interface State {
  failed: boolean;
}

/**
 * Last line of defence for a render error. Without it React unmounts the whole
 * tree and a stranger arriving from a room link sees a blank white page with no
 * way forward. Everything rendered comes from the server's room state, so one
 * unexpected value there must not cost the visitor the site.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[moji] render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        role="alert"
        className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 p-6 text-center"
      >
        <Wordmark />
        <div className="max-w-sm space-y-2">
          <h1 className="font-display text-2xl font-extrabold">Something went sideways.</h1>
          <p className="text-muted">
            The game hit a snag on this screen. Reloading usually puts you back where you were.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <StickerButton onClick={() => window.location.reload()}>Reload</StickerButton>
          <StickerButton variant="outline" onClick={() => window.location.assign('/')}>
            Home
          </StickerButton>
        </div>
      </main>
    );
  }
}
