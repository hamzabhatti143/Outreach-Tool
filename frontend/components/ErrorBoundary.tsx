"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center h-64 text-center text-gray-500">
            <div>
              <p className="font-medium">Something went wrong</p>
              <p className="text-sm mt-1">Refresh the page to try again.</p>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
