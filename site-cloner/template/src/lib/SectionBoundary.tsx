import { Component, type ReactNode } from 'react';

declare global {
  interface Window {
    __sectionErrors?: { id: string; message: string }[];
  }
}

/** Isolates a crashing section so the rest of the page still renders (and records the error for the validator). */
export default class SectionBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    (window.__sectionErrors ??= []).push({ id: this.props.id, message: error.message });
    console.error(`[section:${this.props.id}]`, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
